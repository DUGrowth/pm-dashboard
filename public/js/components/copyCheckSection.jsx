/* global React, DEFAULT_GUIDELINES, getPlatformCaption, PlatformIcon, Button */

// Expose as a global so inline Babel can reference it without module bundling
;(function init() {
  if (typeof window === 'undefined' || window.CopyCheckSection) return;

  window.CopyCheckSection = function CopyCheckSection({ caption, platformCaptions, platforms, assetType, guidelines, currentUser, onApply }) {
    const [open, setOpen] = React.useState(false);
    const [loading, setLoading] = React.useState(false);
    const [error, setError] = React.useState('');
    const [results, setResults] = React.useState({}); // { [platform]: { suggestion, score, flags } }
    const safeGuidelines = guidelines && typeof guidelines === 'object' ? guidelines : DEFAULT_GUIDELINES;

    const selectedPlatforms = platforms && platforms.length ? platforms : ['LinkedIn'];

    const runChecks = async () => {
      setLoading(true);
      setError('');
      try {
        const tasks = selectedPlatforms.map(async (platform) => {
          const maxChars = safeGuidelines?.charLimits?.[platform] ?? 280;
          const effectiveAssetType = assetType === 'No asset' ? 'Design' : assetType;
          const payload = {
            text: getPlatformCaption(caption, platformCaptions, platform),
            platform,
            assetType: effectiveAssetType,
            readingLevelTarget: 'Grade 7',
            constraints: { maxChars, maxHashtags: 10, requireCTA: true },
            brand: {
              bannedWords: safeGuidelines?.bannedWords || [],
              requiredPhrases: safeGuidelines?.requiredPhrases || [],
              tone: { confident: 0.8, compassionate: 0.7, evidenceLed: 1.0 },
            },
          };
          let json;
          if (window.copyChecker && typeof window.copyChecker.runCopyCheck === 'function') {
            json = await window.copyChecker.runCopyCheck(payload);
          } else {
            const res = await fetch('/api/copy-check', {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify(payload),
            });
            if (!res.ok) {
              const j = await res.json().catch(() => ({}));
              throw new Error(j?.error || `HTTP ${res.status}`);
            }
            json = await res.json();
          }
          return { platform, data: json };
        });
        const settled = await Promise.allSettled(tasks);
        const successes = {};
        const failures = [];
        settled.forEach((result) => {
          if (result.status === 'fulfilled') {
            successes[result.value.platform] = result.value.data;
          } else {
            failures.push(result.reason);
          }
        });
        if (Object.keys(successes).length) {
          setResults((prev) => ({ ...prev, ...successes }));
        }
        if (failures.length) {
          setError(`Copy check failed for ${failures.length} platform${failures.length > 1 ? 's' : ''}.`);
        } else {
          setError('');
        }
      } catch (e) {
        setError(e?.message || 'Copy check failed');
      } finally {
        setLoading(false);
      }
    };

    return (
      <div className="rounded-2xl border border-aqua-200 bg-aqua-50 p-3">
        <div className="flex items-center justify-between gap-2">
          <div className="text-sm font-semibold text-ocean-700">AI Copy Checker</div>
          <div className="flex items-center gap-2">
            <Button size="sm" onClick={() => { setOpen(true); runChecks(); }} disabled={loading}>
              {loading ? 'Checking…' : 'Copy check'}
            </Button>
            {open ? (
              <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>Hide</Button>
            ) : null}
          </div>
        </div>
        {open && (
          <div className="mt-3 space-y-3">
            {error ? (
              <div className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</div>
            ) : null}
            {selectedPlatforms.map((platform) => {
              const r = results[platform];
              return (
                <div key={platform} className="rounded-xl border border-graystone-200 bg-white p-3 shadow-sm">
                  <div className="mb-2 flex items-center justify-between">
                    <div className="flex items-center gap-2 text-sm font-semibold text-ocean-700">
                      <PlatformIcon platform={platform} />
                      {platform}
                    </div>
                    {r?.score ? (
                      <div className="flex items-center gap-2 text-[11px] text-graystone-600">
                        <span>RL: {r.score.readingLevel}</span>
                        <span>Clarity {(r.score.clarity*100|0)}%</span>
                        <span>Brevity {(r.score.brevity*100|0)}%</span>
                      </div>
                    ) : null}
                  </div>
                  <textarea
                    className="w-full rounded-2xl border border-graystone-200 px-3 py-2 text-sm shadow-sm focus:border-ocean-500 focus:outline-none focus:ring-2 focus:ring-aqua-200"
                    rows={3}
                    readOnly
                    value={r?.suggestion?.text || ''}
                    placeholder={loading ? 'Generating suggestion…' : 'No suggestion yet'}
                  />
                  {r?.flags && r.flags.length ? (
                    <div className="mt-2 flex flex-wrap gap-1">
                      {r.flags.map((f, i) => (
                        <span key={i} className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] text-amber-800">{f}</span>
                      ))}
                    </div>
                  ) : null}
                  <div className="mt-2 flex items-center gap-2">
                    <Button size="sm" onClick={() => onApply(platform, r?.suggestion?.text || '', safeGuidelines)} disabled={!r || !r.suggestion?.text}>
                      Apply
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => setResults((prev) => { const n = { ...prev }; delete n[platform]; return n; })}>
                      Reject
                    </Button>
                  </div>
                </div>
              );
            })}
            {Object.keys(results).length > 1 ? (
              <div className="flex items-center justify-end">
                <Button size="sm" onClick={() => {
                  selectedPlatforms.forEach((p) => {
                    const t = results[p]?.suggestion?.text;
                    if (t) onApply(p, t, safeGuidelines);
                  });
                }}>Apply all</Button>
              </div>
            ) : null}
          </div>
        )}
      </div>
    );
  };
})();
