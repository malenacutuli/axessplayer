// The faux phone status bar from the prototype (9:41 / signal). Decorative chrome inside the frame.
// Hidden from assistive tech. No em dashes.

export function StatusBar() {
  return (
    <div className="statusbar" aria-hidden="true">
      <span>9:41</span>
      <span>5G &#9646;&#9646;&#9646;</span>
    </div>
  );
}
