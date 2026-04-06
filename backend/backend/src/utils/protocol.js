export function generateProtocol() {
  return `AGD-${Date.now()}`;
}
export function generateCheckinToken() {
  return `CHK-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}
