export interface City {
  name: string
  lat: number
  lng: number
  country?: string
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
  country?: string
}

/** Real launch cities the strike control can fire from. */
export const SILOS: Silo[] = [
  { name: 'Washington', lat: 38.9, lng: -77.04, country: 'USA' },
  { name: 'Moscow', lat: 55.75, lng: 37.62, country: 'Russia' },
  { name: 'Beijing', lat: 39.9, lng: 116.41, country: 'China' },
  { name: 'New Delhi', lat: 28.61, lng: 77.21, country: 'India' },
  { name: 'Islamabad', lat: 33.68, lng: 73.05, country: 'Pakistan' },
  { name: 'Pyongyang', lat: 39.03, lng: 125.75, country: 'North Korea' },
  { name: 'Tel Aviv', lat: 32.08, lng: 34.78, country: 'Israel' },
  { name: 'Riyadh', lat: 24.71, lng: 46.68, country: 'Saudi Arabia' },
  { name: 'Tehran', lat: 35.69, lng: 51.39, country: 'Iran' },
  { name: 'Berlin', lat: 52.52, lng: 13.4, country: 'Germany' },
  { name: 'Ottawa', lat: 45.42, lng: -75.7, country: 'Canada' },
  { name: 'Brasilia', lat: -15.79, lng: -47.88, country: 'Brazil' },
  { name: 'Canberra', lat: -35.28, lng: 149.13, country: 'Australia' },
]

export const CITIES: City[] = [
  { name: 'New York', lat: 40.71, lng: -74.01, country: 'USA', hub: true },
  { name: 'London', lat: 51.51, lng: -0.13, country: 'United Kingdom', hub: true },
  { name: 'Paris', lat: 48.86, lng: 2.35, country: 'France' },
  { name: 'Tokyo', lat: 35.68, lng: 139.69, country: 'Japan', hub: true },
  { name: 'Kuala Lumpur', lat: 3.139, lng: 101.6869, country: 'Malaysia', hub: true },
  { name: 'Dubai', lat: 25.2, lng: 55.27, country: 'United Arab Emirates', hub: true },
  { name: 'Sydney', lat: -33.87, lng: 151.21, country: 'Australia' },
  { name: 'Sao Paulo', lat: -23.55, lng: -46.63, country: 'Brazil', hub: true },
  { name: 'Lagos', lat: 6.52, lng: 3.38, country: 'Nigeria' },
  { name: 'Mumbai', lat: 19.08, lng: 72.88, country: 'India', hub: true },
  { name: 'Shanghai', lat: 31.23, lng: 121.47, country: 'China' },
  { name: 'Los Angeles', lat: 34.05, lng: -118.24, country: 'USA', hub: true },
  { name: 'Cairo', lat: 30.04, lng: 31.24, country: 'Egypt' },
  { name: 'Moscow', lat: 55.75, lng: 37.62, country: 'Russia' },
  { name: 'Toronto', lat: 43.65, lng: -79.38, country: 'Canada' },
  { name: 'Johannesburg', lat: -26.2, lng: 28.05, country: 'South Africa' },
  { name: 'Mexico City', lat: 19.43, lng: -99.13, country: 'Mexico' },
  { name: 'Seoul', lat: 37.57, lng: 126.98, country: 'South Korea' },
  { name: 'Bangkok', lat: 13.76, lng: 100.5, country: 'Thailand' },
  { name: 'Istanbul', lat: 41.01, lng: 28.98, country: 'Turkey' },
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
