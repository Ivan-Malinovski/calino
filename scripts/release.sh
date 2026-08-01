#!/bin/bash
set -e

# ─── Colors ────────────────────────────────────────────────────────────────────
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

step() { echo -e "\n${CYAN}▶ $1${NC}"; }
ok()   { echo -e "${GREEN}✅ $1${NC}"; }
warn() { echo -e "${YELLOW}⚠️  $1${NC}"; }
fail() { echo -e "${RED}❌ $1${NC}"; exit 1; }

# ─── Parse args ────────────────────────────────────────────────────────────────
BUMP=""
SKIP_DOCKER=false
SKIP_PUSH=false
DRY_RUN=false
DOCKER_PUSH=false

while [[ $# -gt 0 ]]; do
  case $1 in
    --patch)    BUMP="patch"; shift ;;
    --minor)    BUMP="minor"; shift ;;
    --major)    BUMP="major"; shift ;;
    --no-docker) SKIP_DOCKER=true; shift ;;
    --no-push)  SKIP_PUSH=true; shift ;;
    --docker-push) DOCKER_PUSH=true; shift ;;
    --dry-run)  DRY_RUN=true; SKIP_PUSH=true; shift ;;
    -h|--help)
      echo "Usage: ./scripts/release.sh [options]"
      echo ""
      echo "Options:"
      echo "  --patch       Bump patch version (0.10.2 → 0.10.3)"
      echo "  --minor       Bump minor version (0.10.2 → 0.11.0)"
      echo "  --major       Bump major version (0.10.2 → 1.0.0)"
      echo "  --no-docker   Skip Docker build & test"
      echo "  --no-push     Bump & commit locally, but don't push to GitHub"
      echo "  --docker-push Build, tag, and push Docker image to GHCR"
      echo "  --dry-run     Full check only — no version bump, no commit, no push"
      echo "  -h, --help    Show this help"
      echo ""
      echo "Environment:"
      echo "  HEALTH_PORT   Host port for the container healthcheck"
      echo "                (default: first free port from 8080 up)"
      echo ""
      echo "Examples:"
      echo "  ./scripts/release.sh --patch          # Bump patch, check, push"
      echo "  ./scripts/release.sh --minor --dry-run # Bump minor, check only"
      echo "  ./scripts/release.sh --docker-push     # Build & push Docker to GHCR"
      echo "  ./scripts/release.sh                   # Just check, no version bump"
      exit 0
      ;;
    *) echo "Unknown option: $1"; exit 1 ;;
  esac
done

CURRENT_DIR=$(pwd)
cd "$(dirname "$0")/.."

# Port the container healthcheck binds on the host. Defaults to the first free
# port at or above 8080; pin it explicitly with
# HEALTH_PORT=8081 ./scripts/release.sh --patch
#
# "Free" has to mean free on *both* families: the container runtime publishes a
# port by binding the wildcard address, so a dev server listening on nothing but
# [::1] is still enough to make `podman run -p` fail. Node's default listen is
# dual-stack, which is exactly the bind we need to test.
port_free() {
  node -e "
    const net = require('net');
    const s = net.createServer();
    s.once('error', () => process.exit(1));
    s.listen($1, () => s.close(() => process.exit(0)));
  " > /dev/null 2>&1
}

if [ -z "$HEALTH_PORT" ]; then
  HEALTH_PORT=8080
  while ! port_free "$HEALTH_PORT"; do
    HEALTH_PORT=$((HEALTH_PORT + 1))
    if [ "$HEALTH_PORT" -gt 8180 ]; then
      fail "No free port found in 8080-8180 for the container healthcheck"
    fi
  done
  if [ "$HEALTH_PORT" != "8080" ]; then
    AUTO_PORT_NOTE="port 8080 was busy"
  fi
fi

# Prefer a real `docker` binary; fall back to podman (common on distros like
# Bazzite/Fedora Atomic where `docker` is only a shell alias, which a
# non-interactive script shell like this one never expands).
if command -v docker > /dev/null 2>&1; then
  ENGINE="docker"
elif command -v podman > /dev/null 2>&1; then
  ENGINE="podman"
else
  ENGINE="docker"
fi

REPO=$(git remote get-url origin | sed 's/.*github.com[:/]\(.\+\)\.git$/\1/')

# ─── Version restore on abort ─────────────────────────────────────────────────
# The bump has to happen before the build, since `pnpm build` bakes
# __APP_VERSION__ into the bundle and the Docker image — testing an image
# stamped with the old version would defeat the point. That means any failure
# after the bump leaves package.json dirty at the new version, and a re-run
# would read it and skip a version. Restore the original on any exit that
# doesn't reach the commit.
PKG_BACKUP=$(mktemp)
BUMPED=false
COMMITTED=false

restore_version() {
  if [ "$BUMPED" = true ] && [ "$COMMITTED" = false ]; then
    cp "$PKG_BACKUP" package.json
    warn "Aborted after the version bump — package.json restored to $CURRENT_VERSION"
  fi
  rm -f "$PKG_BACKUP"
}
trap restore_version EXIT

# ─── Changelog extraction ─────────────────────────────────────────────────────
# Pull the "## [x.y.z]" section out of CHANGELOG.md so the GitHub Release shows
# the human-written notes rather than just a commit list.
extract_changelog() {
  awk -v header="## [$1]" '
    index($0, header) == 1 { found = 1; next }
    found && /^## \[/     { exit }
    found                 { print }
  ' CHANGELOG.md
}

# ─── Pre-flight checks ────────────────────────────────────────────────────────
step "Pre-flight checks"

if [ -n "$(git status --porcelain)" ]; then
  warn "Working tree has uncommitted changes"
  if [ -t 0 ]; then
    read -p "Continue anyway? (y/N) " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
      exit 1
    fi
  else
    echo "  (non-interactive mode, continuing)"
  fi
fi

BRANCH=$(git branch --show-current)
echo "  Branch: $BRANCH"

CURRENT_VERSION=$(node -p "require('./package.json').version")
echo "  Version: $CURRENT_VERSION"

if [ -n "$BUMP" ]; then
  NEW_VERSION=$(node -e "
    const [major, minor, patch] = '$CURRENT_VERSION'.split('.').map(Number);
    if ('$BUMP' === 'major') console.log((major+1) + '.0.0');
    else if ('$BUMP' === 'minor') console.log(major + '.' + (minor+1) + '.0');
    else console.log(major + '.' + minor + '.' + (patch+1));
  ")
  echo -e "  New version: ${GREEN}$NEW_VERSION${NC}"

  if [ -z "$(extract_changelog "$NEW_VERSION")" ]; then
    warn "CHANGELOG.md has no '## [$NEW_VERSION]' section — the release will fall back to generated notes"
  fi
fi

# ─── Typecheck ─────────────────────────────────────────────────────────────────
step "Typecheck"
pnpm typecheck
ok "Typecheck passed"

# ─── Lint ──────────────────────────────────────────────────────────────────────
step "Lint"
# Trust eslint's exit code, not a parse of its output. The counts below are
# only for the summary line: `grep -oP` needs a UTF-8 locale and dies under
# others, and with a `|| echo 0` fallback that turned every lint failure into
# a silent pass. -E is portable.
LINT_STATUS=0
LINT_OUTPUT=$(pnpm lint 2>&1) || LINT_STATUS=$?
LINT_ERRORS=$(echo "$LINT_OUTPUT" | grep -oE '[0-9]+ errors' | grep -oE '[0-9]+' | head -1)
LINT_WARNINGS=$(echo "$LINT_OUTPUT" | grep -oE '[0-9]+ warnings' | grep -oE '[0-9]+' | head -1)
LINT_ERRORS=${LINT_ERRORS:-0}
LINT_WARNINGS=${LINT_WARNINGS:-0}

if [ "$LINT_STATUS" -ne 0 ]; then
  echo "$LINT_OUTPUT"
  fail "Lint failed (exit $LINT_STATUS, $LINT_ERRORS errors)"
fi
ok "Lint passed ($LINT_ERRORS errors, $LINT_WARNINGS warnings)"

# ─── Tests ─────────────────────────────────────────────────────────────────────
step "Tests"
pnpm test:run
ok "All tests passed"

# ─── Version bump ──────────────────────────────────────────────────────────────
if [ -n "$BUMP" ]; then
  step "Bumping version: $CURRENT_VERSION → $NEW_VERSION"

  if [ "$DRY_RUN" = true ]; then
    warn "Dry run — would bump to $NEW_VERSION"
  else
    cp package.json "$PKG_BACKUP"
    BUMPED=true
    # Update package.json
    node -e "
      const fs = require('fs');
      const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
      pkg.version = '$NEW_VERSION';
      fs.writeFileSync('package.json', JSON.stringify(pkg, null, 2) + '\n');
    "
    ok "package.json updated to $NEW_VERSION"
  fi
fi

# ─── Build ─────────────────────────────────────────────────────────────────────
step "Build"
pnpm build
ok "Build succeeded"

# ─── Docker ────────────────────────────────────────────────────────────────────
if [ "$SKIP_DOCKER" = false ]; then
  step "Docker build ($ENGINE)"

  # Check if the engine is running
  if ! $ENGINE info > /dev/null 2>&1; then
    fail "$ENGINE is not running. Start it, or use --no-docker"
  fi

  $ENGINE build -t calino:test . > /dev/null 2>&1
  ok "Image built"

  step "Container healthcheck"
  if [ -n "$AUTO_PORT_NOTE" ]; then
    echo "  Using port $HEALTH_PORT ($AUTO_PORT_NOTE)"
  fi

  # Always address 127.0.0.1, never "localhost": that resolves to ::1 first, so
  # any unrelated service on IPv6 $HEALTH_PORT (a dev server, say) answers
  # instead of the container and the check reports nonsense.
  probe() { curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:$HEALTH_PORT$1" 2>/dev/null || true; }

  # An earlier aborted run can leave the container alive and holding the port,
  # which would otherwise trip the conflict check below with a misleading message.
  $ENGINE rm -f calino-release-test > /dev/null 2>&1 || true

  # Fail loudly on a port conflict rather than silently testing the squatter.
  if [ "$(probe /)" != "000" ]; then
    fail "Something is already serving on port $HEALTH_PORT. Stop it, or pin another port with HEALTH_PORT=..."
  fi

  $ENGINE run -d --name calino-release-test -p "$HEALTH_PORT:8080" calino:test > /dev/null

  # Wait for container to be healthy
  ATTEMPTS=0
  MAX_ATTEMPTS=15
  while [ $ATTEMPTS -lt $MAX_ATTEMPTS ]; do
    # Assign without a `|| echo` fallback — that appends to curl's own output
    # and produces impossible statuses like "426000".
    STATUS=$(probe /)
    if [ "$STATUS" = "200" ]; then
      break
    fi
    sleep 1
    ATTEMPTS=$((ATTEMPTS + 1))
  done

  if [ "$STATUS" != "200" ]; then
    $ENGINE logs calino-release-test
    $ENGINE rm -f calino-release-test > /dev/null 2>&1
    $ENGINE rmi calino:test > /dev/null 2>&1
    fail "Container healthcheck failed (status: $STATUS)"
  fi

  # Verify SPA routes
  SPA_STATUS=$(probe /week)
  if [ "$SPA_STATUS" != "200" ]; then
    $ENGINE rm -f calino-release-test > /dev/null 2>&1
    $ENGINE rmi calino:test > /dev/null 2>&1
    fail "SPA route /week returned $SPA_STATUS"
  fi

  $ENGINE rm -f calino-release-test > /dev/null 2>&1
  $ENGINE rmi calino:test > /dev/null 2>&1
  ok "Container healthcheck passed"

  # Show what tags CI will generate
  echo ""
  echo "  Docker tags (CI will generate):"
  echo "    - ghcr.io/ivan-malinovski/calino:main"
  echo "    - ghcr.io/ivan-malinovski/calino:latest"
  if [ -n "$NEW_VERSION" ]; then
    echo "    - ghcr.io/ivan-malinovski/calino:$NEW_VERSION"
  else
    echo "    - ghcr.io/ivan-malinovski/calino:$CURRENT_VERSION"
  fi
  echo "    - ghcr.io/ivan-malinovski/calino:sha-$(git rev-parse --short HEAD)"
fi

# ─── Docker push to GHCR ──────────────────────────────────────────────────────
if [ "$DOCKER_PUSH" = true ]; then
  step "Pushing image to GHCR ($ENGINE)"

  if ! $ENGINE info > /dev/null 2>&1; then
    fail "$ENGINE is not running"
  fi

  # Login to GHCR
  echo "  Logging in to ghcr.io..."
  echo "$GITHUB_TOKEN" | $ENGINE login ghcr.io -u "$GITHUB_ACTOR" --password-stdin 2>/dev/null || {
    # Fallback: try using existing credentials
    $ENGINE pull ghcr.io/ivan-malinovski/calino:latest > /dev/null 2>&1 || true
  }

  VERSION_TAG="${NEW_VERSION:-$CURRENT_VERSION}"
  SHA_TAG="sha-$(git rev-parse --short HEAD)"
  IMAGE="ghcr.io/ivan-malinovski/calino"

  # Build with all tags
  step "Building with tags: main, latest, $VERSION_TAG, $SHA_TAG"
  $ENGINE build \
    -t "$IMAGE:main" \
    -t "$IMAGE:latest" \
    -t "$IMAGE:$VERSION_TAG" \
    -t "$IMAGE:$SHA_TAG" \
    .

  # Push all tags
  step "Pushing tags"
  $ENGINE push "$IMAGE:main"
  $ENGINE push "$IMAGE:latest"
  $ENGINE push "$IMAGE:$VERSION_TAG"
  $ENGINE push "$IMAGE:$SHA_TAG"

  ok "Image pushed to GHCR"
  echo ""
  echo "  Tags pushed:"
  echo "    - $IMAGE:main"
  echo "    - $IMAGE:latest"
  echo "    - $IMAGE:$VERSION_TAG"
  echo "    - $IMAGE:$SHA_TAG"
fi

# ─── Commit & push ─────────────────────────────────────────────────────────────
if [ -n "$BUMP" ] && [ "$DRY_RUN" = false ]; then
  step "Committing version bump"
  git add package.json
  git commit -m "chore: bump version to $CURRENT_VERSION → $NEW_VERSION"
  COMMITTED=true
  ok "Version bump committed"
fi

if [ "$SKIP_PUSH" = false ]; then
  step "Pushing to $BRANCH"
  git push origin "$BRANCH"

  # Also push the version tag and create GitHub Release if we bumped
  if [ -n "$BUMP" ]; then
    git tag "v$NEW_VERSION"
    git push origin "v$NEW_VERSION"

    # Create GitHub Release, preferring the hand-written CHANGELOG section over
    # the generated commit list.
    step "Creating GitHub Release v$NEW_VERSION"
    NOTES_FILE=$(mktemp)
    extract_changelog "$NEW_VERSION" > "$NOTES_FILE"

    if [ -s "$NOTES_FILE" ]; then
      printf '\n**Full Changelog**: https://github.com/%s/compare/v%s...v%s\n' \
        "$REPO" "$CURRENT_VERSION" "$NEW_VERSION" >> "$NOTES_FILE"
      gh release create "v$NEW_VERSION" \
        --title "v$NEW_VERSION" \
        --notes-file "$NOTES_FILE" \
        --repo "$REPO" \
        2>/dev/null || echo "  (release creation skipped — install gh CLI for auto-releases)"
    else
      warn "No CHANGELOG section for $NEW_VERSION — using generated notes"
      gh release create "v$NEW_VERSION" \
        --title "v$NEW_VERSION" \
        --generate-notes \
        --repo "$REPO" \
        2>/dev/null || echo "  (release creation skipped — install gh CLI for auto-releases)"
    fi
    rm -f "$NOTES_FILE"
    ok "Release v$NEW_VERSION created"
  fi

  ok "Pushed to $BRANCH"
fi

# ─── Done ──────────────────────────────────────────────────────────────────────
echo ""
echo -e "${GREEN}═══════════════════════════════════════════════════════════════${NC}"
echo -e "${GREEN}  Release check complete!${NC}"
if [ -n "$BUMP" ]; then
  echo -e "${GREEN}  Version: $CURRENT_VERSION → $NEW_VERSION${NC}"
fi
if [ "$SKIP_PUSH" = true ]; then
  echo -e "${YELLOW}  (not pushed — use without --no-push to push)${NC}"
fi
echo -e "${GREEN}═══════════════════════════════════════════════════════════════${NC}"
