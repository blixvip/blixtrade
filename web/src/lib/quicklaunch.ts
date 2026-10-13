import { create } from "zustand";
// The quick launch window (components/QuickLaunch.tsx): opened from the status bar's Launch button on any page.
export const useQuickLaunch = create<{ open: boolean }>(() => ({ open: false }));
export const openQuickLaunch = () => useQuickLaunch.setState({ open: true });
export const closeQuickLaunch = () => useQuickLaunch.setState({ open: false });
export const toggleQuickLaunch = () => useQuickLaunch.setState((s) => ({ open: !s.open }));
