export const formatMMSS = (sec) =>
  `${String(Math.floor(sec / 60)).padStart(2, "0")}:${String(
    Math.floor(sec % 60)
  ).padStart(2, "0")}`;
