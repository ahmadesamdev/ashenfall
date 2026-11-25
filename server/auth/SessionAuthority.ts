export async function isPrincipalCurrent(
  repo: any,
  principal: any,
): Promise<boolean> {
  if (
    !principal ||
    (principal.kind !== "account" && principal.kind !== "guest")
  )
    return false;
  if (principal.kind === "guest") return Boolean(principal.guestId);
  const accountId = String(principal.accountId || "");
  if (!accountId) return false;
  const account = await repo.authGetAccountById(accountId);
  return (
    Boolean(account?.verified) &&
    Number(principal.sessionVersion || 1) ===
      Number(account.sessionVersion || 1)
  );
}
