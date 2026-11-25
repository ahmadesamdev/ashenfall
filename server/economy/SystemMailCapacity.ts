export function makeRoomForSystemMail(list: any[]): boolean {
  const disposable = list.findIndex(
    (m) =>
      m?.system && !(m.payload?.items?.length || Number(m.payload?.gold) > 0),
  );
  if (disposable < 0) return false;
  list.splice(disposable, 1);
  return true;
}
