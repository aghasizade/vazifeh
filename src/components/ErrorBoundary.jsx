import { Component } from 'react';
import { cacheClear } from '../lib/api.js';

// Last line of defence: an unexpected error shows a short message with a reload button instead of a blank screen.
export class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    console.error(error, info?.componentStack);
  }

  reload = () => {
    cacheClear();
    window.location.reload();
  };

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="grid h-full place-items-center p-6">
        <div className="card max-w-sm p-6 text-center">
          <p className="mb-1 font-extrabold">مشکلی در نمایش این صفحه پیش آمد.</p>
          <p className="mb-4 text-sm leading-7 text-ink-500">داده‌ها سالم هستند. با بارگذاری دوباره، صفحه از نو ساخته می‌شود.</p>
          <button type="button" onClick={this.reload} className="h-10 rounded-xl bg-ink-900 px-5 text-sm font-bold text-white">بارگذاری دوباره</button>
        </div>
      </div>
    );
  }
}
