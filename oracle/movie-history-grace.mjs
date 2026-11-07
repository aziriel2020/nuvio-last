const month = new Intl.DateTimeFormat('sv-SE', {timeZone:'Europe/Brussels',year:'numeric',month:'2-digit'});
export function historyGraceMs(urlLike, now=new Date()) {
  let path;
  try { path = new URL(String(urlLike)).pathname; } catch { return 0; }
  const matched=path.match(/^\/movies\/(?:(?:collections-only|mobile-desktop-collections|native-bridge(?:\/mobile)?)\/)?catalog\/movie\/(movies-fr-(?:all|streaming|vod|cinema)-[^/]+?)(?:\/[^/]+)?\.json$/);
  if(!matched) return 0;
  const id=matched[1];
  const current=month.format(now);
  const oldMonth=id.match(/-(20\d{2})-(0[1-9]|1[0-2])$/);
  if(oldMonth) return (oldMonth[1]+'-'+oldMonth[2])<current ? 180000 : 0;
  const oldYear=id.match(/-annual-(20\d{2})$/);
  return oldYear && Number(oldYear[1])<Number(current.slice(0,4)) ? 180000 : 0;
}
