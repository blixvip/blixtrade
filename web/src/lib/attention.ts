// Element visibility and tab visibility are separate: split-screen windows still count.
// Keep chart/cache state mounted while suspending its dedicated network work.
export function observeAttention(element: Element, update: (visible: boolean) => void) {
  const rect = element.getBoundingClientRect();
  let intersecting = rect.width > 0 && rect.height > 0 && rect.bottom > 0 && rect.top < innerHeight && rect.right > 0 && rect.left < innerWidth;
  const emit = () => update(intersecting && !document.hidden);
  const observer = new IntersectionObserver(entries => {
    intersecting = entries.some(entry => entry.isIntersecting);
    emit();
  });
  observer.observe(element);
  document.addEventListener('visibilitychange', emit);
  emit();
  return () => { observer.disconnect(); document.removeEventListener('visibilitychange', emit); };
}
