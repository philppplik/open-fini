#!/usr/bin/env bash
# Uploads a file to a (draft) GitHub release, replacing an asset of the same name.
#
#   GH_TOKEN=... GITHUB_REPOSITORY=owner/repo upload-release-asset.sh <release-id> <file> [asset-name]
#
# Works for draft releases, which `gh release upload <tag>` cannot address by tag.
set -euo pipefail

release_id=${1:?release id required}
file=${2:?file required}
name=${3:-$(basename "$file")}
: "${GH_TOKEN:?GH_TOKEN is required}"
: "${GITHUB_REPOSITORY:?GITHUB_REPOSITORY is required}"

if [[ ! "$name" =~ ^[A-Za-z0-9._-]+$ ]]; then
  echo "Unsupported asset name: $name" >&2
  exit 1
fi

# Re-runs: remove the asset from the previous attempt first.
existing=$(gh api "repos/$GITHUB_REPOSITORY/releases/$release_id/assets" --paginate \
  --jq ".[] | select(.name == \"$name\") | .id")
for id in $existing; do
  gh api -X DELETE "repos/$GITHUB_REPOSITORY/releases/assets/$id" > /dev/null
done

curl --fail-with-body -sS -X POST \
  -H "Authorization: Bearer $GH_TOKEN" \
  -H "Accept: application/vnd.github+json" \
  -H "Content-Type: application/octet-stream" \
  --data-binary "@$file" \
  "https://uploads.github.com/repos/$GITHUB_REPOSITORY/releases/$release_id/assets?name=$name" > /dev/null

echo "Uploaded $name to release $release_id"
