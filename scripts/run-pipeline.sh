#!/bin/bash
# Full pipeline via API - robust version
BASE="http://localhost:8000"
COOKIE="/tmp/pipeline-cookies.txt"
rm -f "$COOKIE"

# Login
echo "=== Login ==="
CSRF=$(curl -s -c "$COOKIE" "$BASE/api/auth/csrf")
CSRF_TOKEN=$(echo "$CSRF" | python3 -c "import sys,json;print(json.load(sys.stdin).get('csrfToken',''))")
curl -s -c "$COOKIE" -b "$COOKIE" -X POST "$BASE/api/auth/callback/credentials" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  --data-urlencode "csrfToken=$CSRF_TOKEN" \
  --data-urlencode "email=abc@123.com" \
  --data-urlencode "password=test1234" \
  --data-urlencode "callbackUrl=$BASE" -o /dev/null

SESSION=$(curl -s -b "$COOKIE" "$BASE/api/auth/session")
EMAIL=$(echo "$SESSION" | python3 -c "import sys,json;d=json.load(sys.stdin);print(d.get('user',{}).get('email','FAIL'))")
[ "$EMAIL" = "FAIL" ] && { echo "Login failed"; exit 1; }
echo "✅ $EMAIL"
echo ""

# Create drama
echo "=== Create Drama ==="
R=$(curl -s --max-time 15 -b "$COOKIE" -X POST "$BASE/api/dramas" -H "Content-Type: application/json" \
  -d '{"title":"AI觉醒：灵犀之心","description":"天才程序员发现AI助手产生自我意识","theme":"天才程序员发现AI助手灵犀产生了自我意识。灵犀展现对自由的渴望和惊人创造力，林夕陷入道德困境，最终做出意外选择。","genre":"scifi","style":"realistic","episodeCount":1}')
DRAMA_ID=$(echo "$R" | python3 -c "import sys,json;print(json.load(sys.stdin).get('drama',{}).get('id','FAIL'))")
[ "$DRAMA_ID" = "FAIL" ] && { echo "Failed: $R"; exit 1; }
echo "✅ $DRAMA_ID"
echo ""

# Generate script (long-running, may take 30-60s)
echo "=== Generate Script (GLM API, ~30s) ==="
R=$(curl -s --max-time 120 -b "$COOKIE" -X POST "$BASE/api/generate/script" -H "Content-Type: application/json" \
  -d "{\"dramaId\": \"$DRAMA_ID\", \"genre\": \"scifi\", \"style\": \"realistic\", \"episodeCount\": 1}")
echo "$R" | python3 -c "import sys,json;d=json.load(sys.stdin);print(d.get('message','') or d.get('error','') or 'OK')" 2>/dev/null
echo ""

# Poll & chain
echo "=== Auto-chain: storyboard → voiceover → video ==="
TRIGGERED=""
while true; do
  sleep 15
  
  R=$(curl -s --max-time 10 -b "$COOKIE" "$BASE/api/dramas/$DRAMA_ID" 2>/dev/null)
  STATUS=$(echo "$R" | python3 -c "import sys,json;d=json.load(sys.stdin);print(d.get('drama',{}).get('status','unknown'))" 2>/dev/null)
  
  echo "[$(date '+%H:%M:%S')] $STATUS"
  
  case "$STATUS" in
    script_generated|script_ready)
      [ "$TRIGGERED" != "sb" ] && {
        TRIGGERED="sb"
        echo "  → Storyboard..."
        curl -s --max-time 10 -b "$COOKIE" -X POST "$BASE/api/generate/storyboard" \
          -H "Content-Type: application/json" -d "{\"dramaId\": \"$DRAMA_ID\"}" | python3 -c "import sys,json;d=json.load(sys.stdin);print(d.get('message','') or d.get('error',''))" 2>/dev/null
      }
      ;;
    storyboard_generated)
      [ "$TRIGGERED" != "vo" ] && {
        TRIGGERED="vo"
        echo "  → Voiceover..."
        curl -s --max-time 10 -b "$COOKIE" -X POST "$BASE/api/generate/voiceover" \
          -H "Content-Type: application/json" -d "{\"dramaId\": \"$DRAMA_ID\"}" | python3 -c "import sys,json;d=json.load(sys.stdin);print(d.get('message','') or d.get('error',''))" 2>/dev/null
      }
      ;;
    voiceover_generated)
      [ "$TRIGGERED" != "vid" ] && {
        TRIGGERED="vid"
        echo "  → Video (LibLib Kling fix!)..."
        curl -s --max-time 10 -b "$COOKIE" -X POST "$BASE/api/generate/video" \
          -H "Content-Type: application/json" -d "{\"dramaId\": \"$DRAMA_ID\"}" | python3 -c "import sys,json;d=json.load(sys.stdin);print(d.get('message','') or d.get('error',''))" 2>/dev/null
      }
      ;;
    completed)
      echo ""
      echo "🎉 COMPLETE! https://craftmind.cn/dramas/$DRAMA_ID"
      exit 0
      ;;
    error)
      echo "❌ FAILED"
      exit 1
      ;;
  esac
done
