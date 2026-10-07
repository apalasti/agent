import { useLayoutEffect, useState, type RefObject } from "react";

export const RING_SLOT_ATTRIBUTE = "data-context-plugin-ring";
export const NATIVE_RING = 'button[aria-label^="Context window"]';
const COMPOSER = "[data-follow-up-composer]";
const FOOTER = "[data-follow-up-composer-footer]";

/** Puts the slot just before bb's ring, or at the end of the footer's right-hand group; false when the footer is gone. */
function place(slot: HTMLElement, composer: Element): boolean {
  const footer = composer.querySelector(FOOTER);
  if (footer === null) {
    slot.remove();
    return false;
  }
  const ring = footer.querySelector(NATIVE_RING);
  if (ring?.parentElement) {
    if (slot.nextElementSibling !== ring) ring.parentElement.insertBefore(slot, ring);
    return true;
  }
  const groups = Array.from(footer.children).filter((child) => child !== slot);
  const rightGroup = groups.length > 1 ? groups[groups.length - 1]! : footer;
  if (slot.parentElement !== rightGroup) rightGroup.appendChild(slot);
  return true;
}

/** A span in this composer's footer, kept in bb's ring spot across re-renders; null when the anchor is not in a follow-up composer. */
export function useFooterSlot(anchor: RefObject<HTMLElement | null>): HTMLElement | null {
  const [slot, setSlot] = useState<HTMLElement | null>(null);
  useLayoutEffect(() => {
    const composer = anchor.current?.closest(COMPOSER);
    if (!composer) return;
    const span = document.createElement("span");
    span.setAttribute(RING_SLOT_ATTRIBUTE, "");
    span.style.display = "contents";
    const sync = () => setSlot(place(span, composer) ? span : null);
    sync();
    const observer = new MutationObserver(sync);
    observer.observe(composer, { childList: true, subtree: true });
    return () => {
      observer.disconnect();
      span.remove();
    };
  }, [anchor]);
  return slot;
}
