/* global React */

;(function init() {
  if (typeof window === 'undefined' || window.Badge) return;
  const cx = (...xs) => xs.filter(Boolean).join(' ');
  window.Badge = function Badge({ variant = 'default', className = '', children }) {
    const styles = {
      default: 'bg-aqua-100 text-ocean-700',
      secondary: 'bg-graystone-100 text-graystone-700',
      outline: 'border border-aqua-200 text-ocean-700 bg-aqua-50',
    };
    return (
      <span className={cx('inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium', styles[variant], className)}>
        {children}
      </span>
    );
  };
})();

