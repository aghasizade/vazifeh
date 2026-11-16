// Live updates: every signed-in client keeps one streaming response open and receives
// small "something changed" events; the client then reloads what it is showing.
const clients = new Map(); // userId -> Set<res>

export function attachClient(req, res, userId) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    // nginx must not buffer the stream on the server.
    'X-Accel-Buffering': 'no'
  });
  res.write('retry: 5000\n\n');
  if (!clients.has(userId)) clients.set(userId, new Set());
  clients.get(userId).add(res);
  const ping = setInterval(() => res.write(': ping\n\n'), 25000);
  req.on('close', () => {
    clearInterval(ping);
    clients.get(userId)?.delete(res);
    if (!clients.get(userId)?.size) clients.delete(userId);
  });
}

function write(res, event) {
  try {
    res.write(`data: ${JSON.stringify(event)}\n\n`);
  } catch { /* connection already gone */ }
}

// userIds: an array of user ids, or 'all'.
export function publish(userIds, event) {
  if (userIds === 'all') {
    clients.forEach((set) => set.forEach((res) => write(res, event)));
    return;
  }
  new Set(userIds).forEach((id) => clients.get(id)?.forEach((res) => write(res, event)));
}

export const onlineUserIds = () => [...clients.keys()];

export function closeAll() {
  clients.forEach((set) => set.forEach((res) => res.end()));
  clients.clear();
}
