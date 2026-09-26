import { create } from 'zustand';

// Short confirmation after an action ("Truck TN06 added"). Errors stay inline next to the
// control that failed, where they can be fixed; toasts only confirm what went through.
const SHOW_MS = 4000;
let nextId = 1;

export const useToasts = create(() => ({ list: [] }));

export function toast(message, tone = 'ok') {
  const id = nextId++;
  useToasts.setState((s) => ({ list: [...s.list.slice(-2), { id, message, tone }] }));
  setTimeout(() => dismissToast(id), SHOW_MS);
}

export function dismissToast(id) {
  useToasts.setState((s) => ({ list: s.list.filter((t) => t.id !== id) }));
}
