/**
 * Weather Integration
 * Provides weather forecast and current conditions using Open-Meteo API
 */

import { Integration, Tool, IntegrationContext } from '../base';

// Weather code mappings for Open-Meteo API
const weatherCodes: Record<number, string> = {
  0: 'Clear sky',
  1: 'Mainly clear',
  2: 'Partly cloudy',
  3: 'Overcast',
  45: 'Fog',
  48: 'Depositing rime fog',
  51: 'Light drizzle',
  53: 'Moderate drizzle',
  55: 'Dense drizzle',
  61: 'Slight rain',
  63: 'Moderate rain',
  65: 'Heavy rain',
  71: 'Slight snow',
  73: 'Moderate snow',
  75: 'Heavy snow',
  80: 'Slight rain showers',
  81: 'Moderate rain showers',
  82: 'Violent rain showers',
  95: 'Thunderstorm',
  96: 'Thunderstorm with slight hail',
  99: 'Thunderstorm with heavy hail',
};

// Short weather codes for forecast display
const weatherCodesShort: Record<number, string> = {
  0: 'Clear',
  1: 'Mainly clear',
  2: 'Partly cloudy',
  3: 'Overcast',
  45: 'Foggy',
  48: 'Rime fog',
  51: 'Light drizzle',
  53: 'Drizzle',
  55: 'Dense drizzle',
  61: 'Light rain',
  63: 'Rain',
  65: 'Heavy rain',
  71: 'Light snow',
  73: 'Snow',
  75: 'Heavy snow',
  80: 'Rain showers',
  81: 'Mod. rain showers',
  82: 'Heavy showers',
  95: 'Thunderstorm',
  96: 'T-storm w/ hail',
  99: 'Severe t-storm',
};

// Weather tools definition
const weatherTools: Tool[] = [
  {
    name: 'get_weather_forecast',
    description:
      'Get weather forecast for a location. Use this when user asks about weather, forecast, temperature, rain, etc. Can specify a location name or coordinates.',
    input_schema: {
      type: 'object',
      properties: {
        location: {
          type: 'string',
          description: "Location name (e.g., 'Paris, France', 'New York')",
        },
        latitude: {
          type: 'number',
          description: 'Latitude coordinate (-90 to 90)',
        },
        longitude: {
          type: 'number',
          description: 'Longitude coordinate (-180 to 180)',
        },
        days: {
          type: 'number',
          description: 'Number of days to forecast (1-16, default 7)',
        },
      },
      required: [],
    },
  },
  {
    name: 'get_current_weather',
    description: 'Get current weather conditions for a location. Use this for real-time weather.',
    input_schema: {
      type: 'object',
      properties: {
        location: {
          type: 'string',
          description: "Location name (e.g., 'San Francisco', 'London')",
        },
        latitude: {
          type: 'number',
          description: 'Latitude coordinate (-90 to 90)',
        },
        longitude: {
          type: 'number',
          description: 'Longitude coordinate (-180 to 180)',
        },
      },
      required: [],
    },
  },
  {
    name: 'search_location',
    description:
      'Find coordinates for a location by name. Use this to get latitude/longitude for weather lookups.',
    input_schema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: "Location name to search (e.g., 'Tokyo', 'New York, NY')",
        },
      },
      required: ['query'],
    },
  },
];

// Geocoding helper function
async function geocodeLocation(locationName: string): Promise<{
  latitude: number;
  longitude: number;
  name: string;
  country: string;
  admin1?: string;
  timezone: string;
}> {
  console.log(`[Weather] Geocoding location: ${locationName}`);

  // Try different variations of the location name
  const variations = [
    locationName,
    // Strip state/country suffix (e.g., "Boston, MA" -> "Boston")
    locationName.split(',')[0].trim(),
    // Replace comma with space
    locationName.replace(/,/g, ' ').trim(),
  ];

  for (const variation of variations) {
    console.log(`[Weather] Trying geocode variation: ${variation}`);
    const url = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(variation)}&count=5&language=en&format=json`;
    const response = await fetch(url);

    if (!response.ok) {
      console.error(`[Weather] Geocoding API failed: ${response.status}`);
      continue;
    }

    const data = (await response.json()) as any;

    if (data.results && data.results.length > 0) {
      // If original had state info, try to match it
      const originalLower = locationName.toLowerCase();
      let bestMatch = data.results[0];

      // Try to find a better match based on state/country
      if (originalLower.includes('ma') || originalLower.includes('massachusetts')) {
        const maMatch = data.results.find((r: any) =>
          r.admin1?.toLowerCase().includes('massachusetts')
        );
        if (maMatch) bestMatch = maMatch;
      } else if (originalLower.includes('tx') || originalLower.includes('texas')) {
        const txMatch = data.results.find((r: any) => r.admin1?.toLowerCase().includes('texas'));
        if (txMatch) bestMatch = txMatch;
      } else if (originalLower.includes('ca') || originalLower.includes('california')) {
        const caMatch = data.results.find((r: any) =>
          r.admin1?.toLowerCase().includes('california')
        );
        if (caMatch) bestMatch = caMatch;
      } else if (originalLower.includes('ny') || originalLower.includes('new york')) {
        const nyMatch = data.results.find((r: any) => r.admin1?.toLowerCase().includes('new york'));
        if (nyMatch) bestMatch = nyMatch;
      }

      console.log(
        `[Weather] Geocoded to: ${bestMatch.latitude}, ${bestMatch.longitude} (${bestMatch.name}, ${bestMatch.admin1 || bestMatch.country})`
      );
      return {
        latitude: bestMatch.latitude,
        longitude: bestMatch.longitude,
        name: bestMatch.name,
        country: bestMatch.country,
        admin1: bestMatch.admin1,
        timezone: bestMatch.timezone,
      };
    }
  }

  console.error(`[Weather] Location not found after all variations: ${locationName}`);
  throw new Error(`Location not found: ${locationName}`);
}

// Execute Weather tool function
async function executeWeatherTool(
  toolName: string,
  toolInput: any,
  _context?: IntegrationContext
): Promise<any> {
  console.log(`[Weather] Executing ${toolName} with input:`, JSON.stringify(toolInput));

  try {
    switch (toolName) {
      case 'search_location': {
        const { query } = toolInput;

        // Try different variations - strip state/country suffix if needed
        const variations = [query, query.split(',')[0].trim(), query.replace(/,/g, ' ').trim()];

        for (const variation of variations) {
          console.log(`[Weather] Searching location variation: ${variation}`);
          const url = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(variation)}&count=5&language=en&format=json`;
          const response = await fetch(url);
          if (!response.ok) continue;
          const data = (await response.json()) as any;

          if (data.results && data.results.length > 0) {
            return {
              locations: data.results.map((r: any) => ({
                name: r.name,
                country: r.country,
                admin1: r.admin1,
                latitude: r.latitude,
                longitude: r.longitude,
                timezone: r.timezone,
                population: r.population,
              })),
            };
          }
        }

        return { error: `No locations found for: ${query}` };
      }

      case 'get_current_weather': {
        let lat: number, lon: number, locationName: string;

        // Handle case where toolInput might be null/undefined
        if (!toolInput) {
          console.error('[Weather] No input provided to get_current_weather');
          return { error: 'Please provide a location name or coordinates' };
        }

        if (toolInput.latitude !== undefined && toolInput.longitude !== undefined) {
          lat = toolInput.latitude;
          lon = toolInput.longitude;
          locationName = `${lat}, ${lon}`;
        } else if (toolInput.location) {
          const geo = await geocodeLocation(toolInput.location);
          lat = geo.latitude;
          lon = geo.longitude;
          locationName = geo.admin1 ? `${geo.name}, ${geo.admin1}` : `${geo.name}, ${geo.country}`;
        } else {
          console.error('[Weather] Neither location nor coordinates provided');
          return { error: 'Please provide either a location name or coordinates' };
        }

        const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,relative_humidity_2m,apparent_temperature,precipitation,weather_code,wind_speed_10m,wind_direction_10m&temperature_unit=fahrenheit&wind_speed_unit=mph&precipitation_unit=inch&timezone=auto`;

        const response = await fetch(url);
        if (!response.ok) throw new Error('Failed to fetch weather');
        const data = (await response.json()) as any;

        const current = data.current;
        return {
          location: locationName,
          temperature: `${Math.round(current.temperature_2m)}°F`,
          feels_like: `${Math.round(current.apparent_temperature)}°F`,
          conditions: weatherCodes[current.weather_code as number] || 'Unknown',
          humidity: `${current.relative_humidity_2m}%`,
          wind: `${Math.round(current.wind_speed_10m)} mph`,
          precipitation: `${current.precipitation}" in last hour`,
          time: current.time,
        };
      }

      case 'get_weather_forecast': {
        let lat: number, lon: number, locationName: string;

        // Handle case where toolInput might be null/undefined
        if (!toolInput) {
          console.error('[Weather] No input provided to get_weather_forecast');
          return { error: 'Please provide a location name or coordinates' };
        }

        const days = Math.min(toolInput.days || 7, 16);

        if (toolInput.latitude !== undefined && toolInput.longitude !== undefined) {
          lat = toolInput.latitude;
          lon = toolInput.longitude;
          locationName = `${lat}, ${lon}`;
        } else if (toolInput.location) {
          const geo = await geocodeLocation(toolInput.location);
          lat = geo.latitude;
          lon = geo.longitude;
          locationName = geo.admin1 ? `${geo.name}, ${geo.admin1}` : `${geo.name}, ${geo.country}`;
        } else {
          console.error('[Weather] Neither location nor coordinates provided');
          return { error: 'Please provide either a location name or coordinates' };
        }

        const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&daily=weather_code,temperature_2m_max,temperature_2m_min,apparent_temperature_max,apparent_temperature_min,precipitation_sum,precipitation_probability_max,sunrise,sunset,wind_speed_10m_max&temperature_unit=fahrenheit&wind_speed_unit=mph&precipitation_unit=inch&timezone=auto&forecast_days=${days}`;

        const response = await fetch(url);
        if (!response.ok) throw new Error('Failed to fetch forecast');
        const data = (await response.json()) as any;

        const daily = data.daily;
        const forecast = [];

        for (let i = 0; i < daily.time.length; i++) {
          const date = new Date(daily.time[i]);
          forecast.push({
            date: daily.time[i],
            day: date.toLocaleDateString('en-US', { weekday: 'short' }),
            conditions: weatherCodesShort[daily.weather_code[i] as number] || 'Unknown',
            high: `${Math.round(daily.temperature_2m_max[i])}°F`,
            low: `${Math.round(daily.temperature_2m_min[i])}°F`,
            precipitation_chance: `${daily.precipitation_probability_max[i]}%`,
            precipitation: `${daily.precipitation_sum[i]}"`,
            wind_max: `${Math.round(daily.wind_speed_10m_max[i])} mph`,
            sunrise: daily.sunrise[i]?.split('T')[1],
            sunset: daily.sunset[i]?.split('T')[1],
          });
        }

        return {
          location: locationName,
          forecast_days: days,
          forecast,
        };
      }

      default:
        return { error: `Unknown weather tool: ${toolName}` };
    }
  } catch (err: any) {
    console.error(`[Weather] Error executing ${toolName}:`, err.message);
    return { error: err.message };
  }
}

// Export weather integration
export const weatherIntegration: Integration = {
  name: 'weather',
  category: 'utilities',
  tools: weatherTools,
  execute: executeWeatherTool as any,
};
