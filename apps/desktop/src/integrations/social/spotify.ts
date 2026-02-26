/**
 * Spotify Integration
 *
 * Provides tools for controlling Spotify playback and searching music:
 * - Get currently playing track
 * - Play/pause/skip controls
 * - Search tracks, artists, albums, playlists
 * - Get user playlists
 *
 * Requires Spotify Premium for playback control features.
 */

import { Integration, Tool, IntegrationContext } from '../base';

// ─────────────────────────────────────────────────────────────────────────────
// Spotify API Helpers
// ─────────────────────────────────────────────────────────────────────────────

const SPOTIFY_API_BASE = 'https://api.spotify.com/v1';

function getSpotifyHeaders(accessToken: string): Record<string, string> {
  return {
    Authorization: `Bearer ${accessToken}`,
    'Content-Type': 'application/json',
  };
}

async function getCurrentlyPlaying(accessToken: string): Promise<any> {
  const headers = getSpotifyHeaders(accessToken);
  const response = await fetch(`${SPOTIFY_API_BASE}/me/player/currently-playing`, { headers });

  if (response.status === 204) {
    return { playing: false, message: 'Nothing currently playing' };
  }

  if (!response.ok) {
    return { error: 'Failed to get now playing' };
  }

  const data = (await response.json()) as any;
  return {
    playing: data.is_playing,
    track: {
      name: data.item?.name,
      artist: data.item?.artists?.map((a: any) => a.name).join(', '),
      album: data.item?.album?.name,
      duration_ms: data.item?.duration_ms,
      progress_ms: data.progress_ms,
    },
  };
}

async function playSpotify(accessToken: string, uri?: string): Promise<any> {
  const headers = getSpotifyHeaders(accessToken);
  const body = uri ? { uris: [uri] } : undefined;

  const response = await fetch(`${SPOTIFY_API_BASE}/me/player/play`, {
    method: 'PUT',
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });

  if (response.status === 204 || response.ok) {
    return { success: true, message: 'Playback started' };
  }

  const err = (await response.json()) as any;
  return { error: err.error?.message || 'Failed to start playback' };
}

async function pauseSpotify(accessToken: string): Promise<any> {
  const headers = getSpotifyHeaders(accessToken);

  const response = await fetch(`${SPOTIFY_API_BASE}/me/player/pause`, {
    method: 'PUT',
    headers,
  });

  if (response.status === 204 || response.ok) {
    return { success: true, message: 'Playback paused' };
  }

  return { error: 'Failed to pause playback' };
}

async function skipToNext(accessToken: string): Promise<any> {
  const headers = getSpotifyHeaders(accessToken);

  const response = await fetch(`${SPOTIFY_API_BASE}/me/player/next`, {
    method: 'POST',
    headers,
  });

  if (response.status === 204 || response.ok) {
    return { success: true, message: 'Skipped to next track' };
  }

  return { error: 'Failed to skip track' };
}

async function skipToPrevious(accessToken: string): Promise<any> {
  const headers = getSpotifyHeaders(accessToken);

  const response = await fetch(`${SPOTIFY_API_BASE}/me/player/previous`, {
    method: 'POST',
    headers,
  });

  if (response.status === 204 || response.ok) {
    return { success: true, message: 'Went to previous track' };
  }

  return { error: 'Failed to go to previous track' };
}

async function searchSpotify(
  accessToken: string,
  query: string,
  type: string = 'track',
  limit: number = 10
): Promise<any> {
  const headers = getSpotifyHeaders(accessToken);
  const maxLimit = Math.min(limit, 50);

  const response = await fetch(
    `${SPOTIFY_API_BASE}/search?q=${encodeURIComponent(query)}&type=${type}&limit=${maxLimit}`,
    { headers }
  );

  if (!response.ok) {
    return { error: 'Search failed' };
  }

  const data = (await response.json()) as any;
  const key = `${type}s`;

  return {
    results: (data[key]?.items || []).map((item: any) => ({
      name: item.name,
      uri: item.uri,
      ...(type === 'track'
        ? {
            artist: item.artists?.map((a: any) => a.name).join(', '),
            album: item.album?.name,
          }
        : {}),
      ...(type === 'artist'
        ? {
            genres: item.genres,
            followers: item.followers?.total,
          }
        : {}),
      ...(type === 'album'
        ? {
            artist: item.artists?.map((a: any) => a.name).join(', '),
            release_date: item.release_date,
          }
        : {}),
      ...(type === 'playlist'
        ? {
            owner: item.owner?.display_name,
            tracks: item.tracks?.total,
          }
        : {}),
    })),
  };
}

async function getUserPlaylists(accessToken: string, limit: number = 20): Promise<any> {
  const headers = getSpotifyHeaders(accessToken);
  const maxLimit = Math.min(limit, 50);

  const response = await fetch(`${SPOTIFY_API_BASE}/me/playlists?limit=${maxLimit}`, { headers });

  if (!response.ok) {
    return { error: 'Failed to get playlists' };
  }

  const data = (await response.json()) as any;
  return {
    playlists: data.items.map((p: any) => ({
      id: p.id,
      name: p.name,
      uri: p.uri,
      tracks: p.tracks?.total,
      public: p.public,
    })),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Tool Definitions
// ─────────────────────────────────────────────────────────────────────────────

const spotifyTools: Tool[] = [
  {
    name: 'get_spotify_now_playing',
    description: 'Get the currently playing track on Spotify.',
    input_schema: {
      type: 'object',
      properties: {},
      required: [],
    },
  },
  {
    name: 'spotify_play',
    description: 'Start or resume playback on Spotify. Requires Spotify Premium.',
    input_schema: {
      type: 'object',
      properties: {
        uri: {
          type: 'string',
          description: 'Spotify URI to play (optional, resumes current if not specified)',
        },
      },
      required: [],
    },
  },
  {
    name: 'spotify_pause',
    description: 'Pause Spotify playback. Requires Spotify Premium.',
    input_schema: {
      type: 'object',
      properties: {},
      required: [],
    },
  },
  {
    name: 'spotify_next',
    description: 'Skip to next track on Spotify. Requires Spotify Premium.',
    input_schema: {
      type: 'object',
      properties: {},
      required: [],
    },
  },
  {
    name: 'spotify_previous',
    description: 'Go to previous track on Spotify. Requires Spotify Premium.',
    input_schema: {
      type: 'object',
      properties: {},
      required: [],
    },
  },
  {
    name: 'search_spotify',
    description: 'Search for tracks, artists, albums, or playlists on Spotify.',
    input_schema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Search query',
        },
        type: {
          type: 'string',
          enum: ['track', 'artist', 'album', 'playlist'],
          description: 'Type to search for (default: track)',
        },
        limit: {
          type: 'number',
          description: 'Number of results (default 10, max 50)',
        },
      },
      required: ['query'],
    },
  },
  {
    name: 'get_spotify_playlists',
    description: "Get the user's Spotify playlists.",
    input_schema: {
      type: 'object',
      properties: {
        limit: {
          type: 'number',
          description: 'Number of playlists (default 20, max 50)',
        },
      },
      required: [],
    },
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// Tool Execution
// ─────────────────────────────────────────────────────────────────────────────

async function executeSpotifyTool(
  toolName: string,
  toolInput: any,
  context: IntegrationContext
): Promise<any> {
  const accessToken = context.accessTokens?.spotify;

  if (!accessToken) {
    return { error: 'Spotify not connected. Please set up Spotify in the Integrations page.' };
  }

  try {
    switch (toolName) {
      case 'get_spotify_now_playing':
        return await getCurrentlyPlaying(accessToken);

      case 'spotify_play':
        return await playSpotify(accessToken, toolInput.uri);

      case 'spotify_pause':
        return await pauseSpotify(accessToken);

      case 'spotify_next':
        return await skipToNext(accessToken);

      case 'spotify_previous':
        return await skipToPrevious(accessToken);

      case 'search_spotify': {
        const type = toolInput.type || 'track';
        const limit = toolInput.limit || 10;
        return await searchSpotify(accessToken, toolInput.query, type, limit);
      }

      case 'get_spotify_playlists': {
        const limit = toolInput.limit || 20;
        return await getUserPlaylists(accessToken, limit);
      }

      default:
        return { error: `Unknown Spotify tool: ${toolName}` };
    }
  } catch (err: any) {
    console.error(`[Spotify] Error executing ${toolName}:`, err.message);
    return { error: err.message };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Integration Export
// ─────────────────────────────────────────────────────────────────────────────

export const spotifyIntegration: Integration = {
  name: 'spotify',
  category: 'social',
  tools: spotifyTools,
  execute: executeSpotifyTool as any,
  isAvailable: async (context: IntegrationContext) => {
    return !!context.accessTokens?.spotify;
  },
};
