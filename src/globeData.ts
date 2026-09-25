export interface City {
  name: string
  lat: number
  lng: number
  hub?: boolean
}

export interface ArcRoute {
  startLat: number
  startLng: number
  endLat: number
  endLng: number
  route: string
}

export interface Silo {
  name: string
  lat: number
  lng: number
}

/** Launch sites the strike control can fire from. */
export const SILOS: Silo[] = [
  { name: 'Vandenberg', lat: 34.74, lng: -120.57 },
  { name: 'Plesetsk', lat: 62.93, lng: 40.58 },
  { name: 'Jiuquan', lat: 40.96, lng: 100.29 },
  { name: 'Kapustin Yar', lat: 48.57, lng: 45.72 },
  { name: 'Woomera', lat: -30.95, lng: 136.53 },
  { name: 'Alcantara', lat: -2.37, lng: -44.4 },
]

export const CITIES: City[] = [
  { name: 'New York', lat: 40.71, lng: -74.01, hub: true },
  { name: 'London', lat: 51.51, lng: -0.13, hub: true },
  { name: 'Paris', lat: 48.86, lng: 2.35 },
  { name: 'Tokyo', lat: 35.68, lng: 139.69, hub: true },
  { name: 'Kuala Lumpur', lat: 3.139, lng: 101.6869, hub: true },
  { name: 'Dubai', lat: 25.2, lng: 55.27, hub: true },
  { name: 'Sydney', lat: -33.87, lng: 151.21 },
  { name: 'Sao Paulo', lat: -23.55, lng: -46.63, hub: true },
  { name: 'Lagos', lat: 6.52, lng: 3.38 },
  { name: 'Mumbai', lat: 19.08, lng: 72.88, hub: true },
  { name: 'Shanghai', lat: 31.23, lng: 121.47 },
  { name: 'Los Angeles', lat: 34.05, lng: -118.24, hub: true },
  { name: 'Cairo', lat: 30.04, lng: 31.24 },
  { name: 'Moscow', lat: 55.75, lng: 37.62 },
  { name: 'Toronto', lat: 43.65, lng: -79.38 },
  { name: 'Johannesburg', lat: -26.2, lng: 28.05 },
  { name: 'Mexico City', lat: 19.43, lng: -99.13 },
  { name: 'Seoul', lat: 37.57, lng: 126.98 },
  { name: 'Bangkok', lat: 13.76, lng: 100.5 },
  { name: 'Istanbul', lat: 41.01, lng: 28.98 },
]

export const HUBS: City[] = CITIES.filter((city) => city.hub)

const ROUTES: Array<[string, string]> = [
  ['New York', 'London'],
  ['New York', 'Los Angeles'],
  ['New York', 'Sao Paulo'],
  ['London', 'Dubai'],
  ['London', 'Lagos'],
  ['London', 'Moscow'],
  ['Paris', 'New York'],
  ['Dubai', 'Mumbai'],
  ['Dubai', 'Kuala Lumpur'],
  ['Kuala Lumpur', 'Sydney'],
  ['Kuala Lumpur', 'Tokyo'],
  ['Tokyo', 'Los Angeles'],
  ['Tokyo', 'Seoul'],
  ['Mumbai', 'Kuala Lumpur'],
  ['Sao Paulo', 'Lagos'],
  ['Sao Paulo', 'Mexico City'],
  ['Los Angeles', 'Sydney'],
  ['Cairo', 'Istanbul'],
  ['Johannesburg', 'Dubai'],
  ['Bangkok', 'Shanghai'],
  ['Toronto', 'London'],
  ['Seoul', 'Shanghai'],
]

const byName = new Map(CITIES.map((city) => [city.name, city]))

export const ROUTE_ARCS: ArcRoute[] = ROUTES.flatMap(([from, to]) => {
  const start = byName.get(from)
  const end = byName.get(to)

  if (!start || !end) return []

  return [
    {
      startLat: start.lat,
      startLng: start.lng,
      endLat: end.lat,
      endLng: end.lng,
      route: `${from} -> ${to}`,
    },
  ]
})
