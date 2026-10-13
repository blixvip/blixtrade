import { create } from "zustand";
// Opening is intentional each visit: no third-party player is loaded in the background.
export const useTikTokWindow = create<{ open: boolean }>(() => ({ open: false }));
export const openTikTokWindow = () => useTikTokWindow.setState({ open: true });
export const closeTikTokWindow = () => useTikTokWindow.setState({ open: false });
