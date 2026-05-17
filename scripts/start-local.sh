#!/bin/bash
# Start LearnGraph locally with all dependencies
# Usage: ./scripts/start-local.sh [--docker | --native]

set -e

MODE="${1:---native}"

echo "🧠 LearnGraph — Local Development"
echo "=================================="

if [ "$MODE" = "--docker" ]; then
  echo "Starting with Docker Compose..."

  # Check for .env file
  if [ ! -f .env ]; then
    echo "⚠️  No .env file found. Creating from .env.example..."
    cp .env.example .env
    echo "Edit .env with your TAVILY_API_KEY before continuing."
    exit 1
  fi

  docker compose up -d

  echo ""
  echo "Waiting for Ollama to start..."
  until curl -s http://localhost:11434/api/tags > /dev/null 2>&1; do sleep 1; done

  # Pull model if not present
  MODEL="${OLLAMA_MODEL:-qwen3:8b}"
  if ! curl -s http://localhost:11434/api/tags | grep -q "$MODEL"; then
    echo "Pulling $MODEL (this may take a few minutes first time)..."
    docker compose exec ollama ollama pull "$MODEL"
  fi

  echo ""
  echo "✓ All services running:"
  echo "  App:     http://localhost:3000"
  echo "  Ollama:  http://localhost:11434"
  echo "  GBrain:  http://localhost:4100"
  echo ""
  echo "Stop with: docker compose down"

elif [ "$MODE" = "--native" ]; then
  echo "Starting native (Ollama + GBrain must be running)..."
  echo ""

  # Check Ollama
  if ! curl -s http://localhost:11434/api/tags > /dev/null 2>&1; then
    echo "❌ Ollama not running. Start with: ollama serve"
    exit 1
  fi
  echo "✓ Ollama: running"

  # Check GBrain
  if ! curl -s http://localhost:4100/health > /dev/null 2>&1; then
    echo "⚠️  GBrain not running (optional). Start with: gbrain serve --http --port 4100"
  else
    echo "✓ GBrain: running"
  fi

  # Check model
  MODEL="${OLLAMA_MODEL:-qwen3:8b}"
  if ! curl -s http://localhost:11434/api/tags | grep -q "$MODEL"; then
    echo "Pulling $MODEL..."
    ollama pull "$MODEL"
  fi
  echo "✓ Model:  $MODEL"

  echo ""
  echo "Starting Next.js dev server..."
  echo "  App: http://localhost:3000"
  echo ""
  npm run dev

else
  echo "Usage: ./scripts/start-local.sh [--docker | --native]"
  echo "  --native  Use locally running Ollama + GBrain (default)"
  echo "  --docker  Start everything via Docker Compose"
  exit 1
fi
