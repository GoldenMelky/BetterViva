export function monthRange(today = new Date()) {
  const first = new Date(today.getFullYear(), today.getMonth(), 1);
  const last = new Date(today.getFullYear(), today.getMonth() + 1, 0);
  return {
    start: new Date(first.getFullYear(), first.getMonth(), first.getDate() - ((first.getDay() + 6) % 7)),
    end: new Date(last.getFullYear(), last.getMonth(), last.getDate() + (6 - (last.getDay() + 6) % 7)),
  };
}
