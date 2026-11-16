// What changed in each version, newest first, in the users' words. The app shows it in the "new version" popup:
// after an update (what is new in this version) and, on Android, when a newer APK is waiting to be installed.
// Add the new version's lines here with every release.
export const CHANGELOG = [
  {
    version: '1.0.10',
    items: [
      'کار شخصی: در «کار جدید برای خودم» کلید «کار شخصی» را روشن کنید تا فقط خودتان آن کار را ببینید؛ مدیر عامل، سرپرست، تابلوی پرسنل و گزارش‌ها آن را نشان نمی‌دهند.',
      'معرفی نسخه جدید: هر به‌روزرسانی با همین پنجره و فهرست تغییرات معرفی می‌شود.',
      'اندروید: دکمه «دریافت و نصب» درصد دریافت نسخه جدید را نشان می‌دهد.'
    ]
  },
  {
    version: '1.0.9',
    items: [
      'تیک پیام‌ها: یک تیک یعنی پیام به سرور رسید، دو تیک آبی یعنی طرف مقابل آن را دید.',
      'یادآور (آلارم) روی کارهای خودتان، حتی وقتی برنامه بسته است.',
      'فرم تسک مرتب‌تر، با ساعت شروع و انتخابگر ساعت گوشی.',
      'پخش تند پیام صوتی دیگر صدا را نازک نمی‌کند.'
    ]
  },
  {
    version: '1.0.7',
    items: [
      'وصل شدن دوباره خودکار بعد از روشن یا خاموش کردن VPN.',
      'پخش‌کننده پیام صوتی با موج صدا و سرعت ۱٫۵ و ۲ برابر.',
      'درصد ارسال پیوست‌ها و پیام‌های صوتی.',
      'تابلوی پرسنل به ترتیب حجم کار.'
    ]
  }
];

const parts = (v) => String(v).split('.').map(Number);
export function compareVersions(a, b) {
  const pa = parts(a);
  const pb = parts(b);
  for (let i = 0; i < 3; i += 1) if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) - (pb[i] || 0);
  return 0;
}

// The entries after `from` up to and including `to` (newest first). Without `from`: just `to`.
export function changesBetween(list, from, to) {
  return list.filter((e) => compareVersions(e.version, to) <= 0 && (from ? compareVersions(e.version, from) > 0 : compareVersions(e.version, to) === 0));
}
