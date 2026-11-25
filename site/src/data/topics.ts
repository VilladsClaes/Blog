// Kendte emner fra de gamle indlæg. De får hver deres statiske side;
// nye emner fra databasen bruger API'ets fælles topic-skabelon.
export interface Topic { slug: string; name: string }

export const topics: Topic[] = [
  { slug: 'arkiv', name: 'arkiv' },
  { slug: 'tips-og-tricks', name: 'tips og tricks' },
  { slug: 'kunstig-intelligens', name: 'kunstig intelligens' },
  { slug: 'lister', name: 'lister' },
  { slug: 'livsforbedring', name: 'livsforbedring' },
  { slug: 'oplaeg', name: 'oplæg' },
  { slug: 'pecha-kucha', name: 'Pecha Kucha' },
  { slug: 'selvindsigt', name: 'selvindsigt' },
  { slug: 'teknologi', name: 'teknologi' },
  { slug: 'vaerktoejer', name: 'værktøjer' },
  { slug: 'blog', name: 'blog' },
  { slug: 'forbrug', name: 'forbrug' },
  { slug: 'husholdning', name: 'husholdning' },
  { slug: 'hyponet', name: 'Hyponet' },
  { slug: 'ideer-til-aktiviteter', name: 'ideer til aktiviteter' },
  { slug: 'lingvistik', name: 'lingvistik' },
  { slug: 'mantra', name: 'mantra' },
  { slug: 'om-bloggen', name: 'om bloggen' },
  { slug: 'opgaveloesning', name: 'opgaveløsning' },
  { slug: 'resursebesparelse', name: 'resursebesparelse' },
  { slug: 'selvforbedring', name: 'selvforbedring' },
  { slug: 'skrivning', name: 'skrivning' },
  { slug: 'slow-living', name: 'slow living' },
  { slug: 'status', name: 'status' },
  { slug: 'tid', name: 'tid' },
  { slug: 'virksomhed', name: 'virksomhed' },
]
