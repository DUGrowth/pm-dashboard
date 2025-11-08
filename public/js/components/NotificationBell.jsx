/* global React */

;(function init() {
  if (typeof window === 'undefined' || window.NotificationBell) return;
  const { useState } = React;
  const cx = (...xs) => xs.filter(Boolean).join(' ');

  window.NotificationBell = function NotificationBell({ notifications, unreadCount, onOpenItem }) {
    const [open, setOpen] = useState(false);
    const topItems = (notifications || []).slice(0, 8);
    return (
      <div className="relative">
        <button
          onClick={() => setOpen((prev) => !prev)}
          className="relative inline-flex h-10 w-10 items-center justify-center rounded-full bg-[#00F5FF] text-black shadow-[0_0_20px_rgba(15,157,222,0.35)] transition hover:-translate-y-0.5"
          aria-label={unreadCount ? `${unreadCount} unread notifications` : 'Notifications'}
        >
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" className="h-5 w-5" fill="currentColor">
            <path d="M12 2a6 6 0 0 0-6 6v2.586a2 2 0 0 1-.586 1.414l-.828.828A1 1 0 0 0 5 15h14a1 1 0 0 0 .707-1.707l-.828-.828A2 2 0 0 1 18 10.586V8a6 6 0 0 0-6-6Zm0 20a3 3 0 0 0 2.995-2.824L15 19h-6a3 3 0 0 0 2.824 2.995L12 22Z" />
          </svg>
          <span className="absolute -bottom-1 -right-1 inline-flex h-5 min-w-[20px] items-center justify-center rounded-full bg-black px-1 text-[11px] font-semibold text-white">
            {unreadCount || 0}
          </span>
        </button>
        {open && (
          <div className="absolute right-0 z-50 mt-2 w-80 rounded-2xl border border-graystone-200 bg-white p-4 shadow-xl">
            <div className="flex items-center justify-between">
              <div className="heading-font flex items-center gap-2 text-sm font-semibold text-ocean-700">
                <span className="inline-block h-3 w-3 rounded-full bg-[#00F5FF]" aria-hidden="true" />
                Notifications
              </div>
              <button className="text-xs text-graystone-500 hover:text-ocean-600" onClick={() => setOpen(false)}>
                Close
              </button>
            </div>
            <div className="mt-3 space-y-2">
              {topItems.length === 0 ? (
                <p className="text-xs text-graystone-500">You're all caught up.</p>
              ) : (
                topItems.map((note) => (
                  <button
                    key={note.id}
                    className={cx(
                      'w-full rounded-xl border px-3 py-2 text-left text-sm transition',
                      note.read
                        ? 'border-graystone-200 bg-white hover:border-aqua-200 hover:bg-aqua-50'
                        : 'border-aqua-200 bg-aqua-50 hover:border-ocean-300',
                    )}
                    onClick={() => {
                      onOpenItem(note);
                      setOpen(false);
                    }}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-medium text-ocean-700">{note.message}</span>
                      <span className="text-[11px] text-graystone-500">
                        {note.createdAt ? new Date(note.createdAt).toLocaleString() : ''}
                      </span>
                    </div>
                  </button>
                ))
              )}
            </div>
          </div>
        )}
      </div>
    );
  };
})();

