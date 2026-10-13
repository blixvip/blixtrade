// Element visibility only: a chart on screen in a background tab still has attention, so it keeps streaming and
// the tab's title keeps its price (the user, 2026-10-12: the site must not freeze while the tab is away).
export function observeAttention(element: Element, update: (visible: boolean) => void) {
  const rect = element.getBoundingClientRect();
  let intersecting = rect.width > 0 && rect.height > 0 && rect.bottom > 0 && rect.top < innerHeight && rect.right > 0 && rect.left < innerWidth;
  const emit = () => update(intersecting);
  const observer = new IntersectionObserver(entries => {
    intersecting = entries.some(entry => entry.isIntersecting);
    emit();
  });
  observer.observe(element);
  document.addEventListener('visibilitychange', emit);
  emit();
  return () => { observer.disconnect(); document.removeEventListener('visibilitychange', emit); };
}
