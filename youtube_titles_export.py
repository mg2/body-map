#!/usr/bin/env python3
"""Export all publicly accessible video titles from Yoga with Kassandra."""

import getpass
import json
import sys
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

API_BASE = "https://www.googleapis.com/youtube/v3"
CHANNEL_HANDLE = "yogawithkassandra"
OUTPUT_FILE = Path(__file__).with_name("yogawithkassandra_titles.txt")


def api_get(resource: str, api_key: str, **params) -> dict:
    """Send a GET request to the YouTube Data API and return JSON."""
    params["key"] = api_key
    url = f"{API_BASE}/{resource}?{urllib.parse.urlencode(params)}"

    try:
        with urllib.request.urlopen(url, timeout=30) as response:
            return json.load(response)
    except urllib.error.HTTPError as exc:
        try:
            details = json.loads(exc.read().decode("utf-8"))
            message = details["error"]["message"]
        except Exception:
            message = str(exc)
        raise RuntimeError(f"YouTube API error ({exc.code}): {message}") from exc
    except urllib.error.URLError as exc:
        raise RuntimeError(f"Network error: {exc.reason}") from exc


def get_uploads_playlist_id(api_key: str) -> str:
    data = api_get(
        "channels",
        api_key,
        part="contentDetails,snippet",
        forHandle=CHANNEL_HANDLE,
    )

    items = data.get("items", [])
    if not items:
        raise RuntimeError(f"Channel @{CHANNEL_HANDLE} was not found.")

    channel = items[0]
    print(f"Channel found: {channel['snippet']['title']}")
    return channel["contentDetails"]["relatedPlaylists"]["uploads"]


def get_all_titles(api_key: str, playlist_id: str) -> list[str]:
    titles = []
    page_token = None

    while True:
        params = {
            "part": "snippet",
            "playlistId": playlist_id,
            "maxResults": 50,
        }
        if page_token:
            params["pageToken"] = page_token

        data = api_get("playlistItems", api_key, **params)

        for item in data.get("items", []):
            # Ensure every title occupies exactly one line in the TXT file.
            title = item["snippet"]["title"].replace("\r", " ").replace("\n", " ")
            titles.append(title)

        print(f"Retrieved {len(titles)} titles...", end="\r", flush=True)
        page_token = data.get("nextPageToken")
        if not page_token:
            break

    print()
    return titles


def main() -> int:
    print(f"YouTube title exporter for @{CHANNEL_HANDLE}")
    api_key = getpass.getpass("Enter your YouTube Data API key: ").strip()

    if not api_key:
        print("Error: No API key entered.", file=sys.stderr)
        return 1

    try:
        uploads_playlist_id = get_uploads_playlist_id(api_key)
        titles = get_all_titles(api_key, uploads_playlist_id)
        OUTPUT_FILE.write_text("\n".join(titles) + ("\n" if titles else ""), encoding="utf-8")
    except (RuntimeError, OSError) as exc:
        print(f"Error: {exc}", file=sys.stderr)
        return 1

    print(f"Done: wrote {len(titles)} titles to:")
    print(OUTPUT_FILE.resolve())
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
