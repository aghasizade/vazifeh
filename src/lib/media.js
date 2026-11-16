// Photos are shrunk on the phone before upload so they go quickly over a weak site connection.
export async function compressImage(file, { maxSide = 1600, quality = 0.8 } = {}) {
  if (!file.type.startsWith('image/') || file.type === 'image/gif' || file.size < 250 * 1024) return file;
  try {
    const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
    const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality));
    if (!blob || blob.size >= file.size) return file;
    const name = file.name.replace(/\.[^.]+$/, '') || 'photo';
    return new File([blob], `${name}.jpg`, { type: 'image/jpeg' });
  } catch {
    return file;
  }
}

export function getLocation({ timeout = 15000 } = {}) {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error('این دستگاه موقعیت مکانی ندارد.'));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: pos.coords.accuracy }),
      (error) => reject(new Error(error.code === 1
        ? 'اجازه دسترسی به موقعیت داده نشد. از تنظیمات گوشی اجازه موقعیت را برای برنامه فعال کنید.'
        : 'موقعیت پیدا نشد. GPS گوشی را روشن کنید و دوباره امتحان کنید.')),
      { enableHighAccuracy: true, timeout, maximumAge: 60000 }
    );
  });
}

export const mapLink = (lat, lng) => `https://www.google.com/maps?q=${lat},${lng}`;
export const neshanLink = (lat, lng) => `https://neshan.org/maps/@${lat},${lng},16z`;

const pickMime = () => ['audio/webm;codecs=opus', 'audio/ogg;codecs=opus', 'audio/webm', 'audio/mp4']
  .find((type) => window.MediaRecorder?.isTypeSupported?.(type)) || '';

// Voice notes: start() asks for the microphone; stop() resolves with { blob, duration, name }.
export function createRecorder() {
  let recorder = null;
  let stream = null;
  let chunks = [];
  let started = 0;
  return {
    supported: Boolean(navigator.mediaDevices?.getUserMedia && window.MediaRecorder),
    async start() {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
      } catch {
        throw new Error('اجازه استفاده از میکروفون داده نشد.');
      }
      const mimeType = pickMime();
      recorder = new MediaRecorder(stream, mimeType ? { mimeType, audioBitsPerSecond: 32000 } : undefined);
      chunks = [];
      recorder.ondataavailable = (e) => e.data.size && chunks.push(e.data);
      recorder.start(1000);
      started = Date.now();
    },
    stop() {
      return new Promise((resolve) => {
        if (!recorder) { resolve(null); return; }
        recorder.onstop = () => {
          stream.getTracks().forEach((t) => t.stop());
          const type = recorder.mimeType || 'audio/webm';
          const blob = new Blob(chunks, { type });
          const ext = type.includes('ogg') ? 'ogg' : type.includes('mp4') ? 'm4a' : 'webm';
          resolve({ blob, duration: (Date.now() - started) / 1000, name: `voice-${Date.now()}.${ext}` });
          recorder = null;
        };
        recorder.stop();
      });
    },
    cancel() {
      if (recorder) {
        recorder.onstop = () => stream.getTracks().forEach((t) => t.stop());
        recorder.stop();
        recorder = null;
      }
    },
    elapsed: () => (started ? (Date.now() - started) / 1000 : 0)
  };
}
