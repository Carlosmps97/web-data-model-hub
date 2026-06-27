/**
 * StubScreen — placeholder page used by Home / Reporting / Review until their
 * real implementations land (R2/R6). Renders under the global TopNav. Kept
 * intentionally minimal; do not build out the real screen here.
 */
export default function StubScreen({ eyebrow, title, note }: { eyebrow: string; title: string; note: string }) {
  return (
    <div className="dmh-stub">
      <div className="dmh-stub-inner">
        <span className="dmh-stub-eyebrow">{eyebrow}</span>
        <h1>{title}</h1>
        <p>{note}</p>
      </div>
    </div>
  );
}
