/** Restore focus after Radix has removed its modal focus scope. A disconnected,
 * hidden or disabled trigger cannot receive focus; use a visible page fallback.
 * @param {(HTMLElement|null|undefined)[]} targets */
export function restoreDialogFocus(targets) {
  for (const target of targets) {
    if (!target?.isConnected || target.matches(':disabled, [aria-disabled="true"]') ||
        target.closest('[hidden], [inert]') || !target.getClientRects().length) continue;
    target.focus({preventScroll: true});
    if (target.ownerDocument.activeElement === target) return true;
  }
  return false;
}
