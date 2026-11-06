// The wristwatch's app list (the file keeps its old name because ui/watch.js reads WATCH_APPS from here).
// There is no money and no store any more: the apps are survival tools. game/progress.js hands the watch this list
// with the drawing of the RECIPES and NOTES faces (ui/watch.js setWatchApps); STATUS and MAP are the watch's own.
//   STATUS   vitals and pulse (and what is wrong: cold, hungry, bleeding)
//   MAP      explored rooms, your shelter, your bed, benches, water and food you found, teammates
//   RECIPES  what you can make, in the hands and at each bench tier
//   NOTES    what earlier clones scribbled down, as you find it
export const WATCH_APPS = [
  { id: 'status', name: 'STATUS', icon: 'pulse', builtin: true },
  { id: 'map', name: 'MAP', icon: 'map', builtin: true },
  { id: 'recipes', name: 'RECIPES', icon: 'task', builtin: true },
  { id: 'notes', name: 'NOTES', icon: 'flag', builtin: true },
];
