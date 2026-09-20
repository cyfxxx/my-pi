# my-pi Deployment Guide (Hard Fork Architecture)

## Quick Deploy (Recommended)

```bash
# 1. Clone project
git clone -b feat/vendor-adapter git@github.com:cyfxxx/my-pi.git ~/my-pi
cd ~/my-pi

# 2. Install dependencies
npm install
cd vendor/pi && npm install && cd ..

# 3. Build
npm run build:offline

# 4. Initialize portable environment
bash scripts/init-portable.sh

# 5. Verify
./my-pi.sh --list-models
```

## Manual Deploy

### Step 1: Install system dependencies

```bash
# Ubuntu/Debian
sudo apt update && sudo apt install -y curl git python3 ripgrep fd-find

# macOS
brew install curl git python3 ripgrep fd
```

### Step 2: Install Node.js v22+

```bash
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.0/install.sh | bash
source ~/.bashrc
nvm install 22
```

### Step 3: Install Bun (optional, for portable binary)

```bash
curl -fsSL https://bun.sh/install | bash
source ~/.bashrc
```

### Step 4: Clone and build

```bash
git clone -b feat/vendor-adapter git@github.com:cyfxxx/my-pi.git ~/my-pi
cd ~/my-pi
npm install
cd vendor/pi && npm install && cd ..
npm run build:offline
```

### Step 5: Initialize portable environment

```bash
bash scripts/init-portable.sh
```

### Step 6: Build portable binary (optional)

```bash
bun build --compile packages/coding-agent/dist/bundle/cli.js --outfile portable/bin/my-pi
```

### Step 7: Verify

```bash
./my-pi.sh --list-models
```

## Portable Deploy (USB Drive)

### First deploy

```bash
# On your development machine
git clone -b feat/vendor-adapter git@github.com:cyfxxx/my-pi.git ~/my-pi
cd ~/my-pi
npm install
cd vendor/pi && npm install && cd ..
npm run build:offline
bash scripts/init-portable.sh

# Copy to USB drive
cp -r ~/my-pi /media/$USER/USBDRIVE/my-pi
```

### Using on new machine

```bash
# Plug in USB drive
cd /media/$USER/USBDRIVE/my-pi
./my-pi.sh --list-models
```

## Directory Structure

```
my-pi/
├── vendor/pi/                        # Upstream code (read-only)
├── custom/                           # Your code (only part to maintain)
│   ├── adapters/                     # Adapter layer
│   ├── features/                     # 12 migrated extensions
│   ├── core/                         # Core services
│   └── src/                          # Shared services
├── portable/                         # Runtime data (portable)
│   ├── bin/                          # Portable binary
│   ├── config/                       # Configuration
│   ├── sessions/                     # Session data
│   └── ...
├── scripts/
│   ├── sync-upstream.sh              # Upstream sync script
│   └── init-portable.sh              # Portable init script
└── my-pi.sh                          # Portable launcher
```

## Troubleshooting

### Command not found

```bash
# Check portable environment
ls -la portable/bin/

# Reinitialize portable environment
bash scripts/init-portable.sh

# Ensure my-pi.sh is executable
chmod +x my-pi.sh
```

### Extension loading failed

```bash
# Reinstall vendor dependencies
cd vendor/pi && npm install && cd ..

# Rebuild
npm run build:offline

# Reinitialize
bash scripts/init-portable.sh
```

### Model not available

```bash
# Check config
cat portable/config/settings.json

# Verify build output
ls -la vendor/pi/dist/

# Reinitialize and rebuild
bash scripts/init-portable.sh
npm run build:offline
```
