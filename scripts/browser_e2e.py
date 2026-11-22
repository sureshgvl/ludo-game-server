"""Browser end-to-end test: plays a full game against a bot in headless Chrome, then checks the
3-game limit. Needs Python Playwright and Chrome. Start the server first, for example:
  PORT=2599 BOT_DELAY_MS=40 AUTO_MOVE_DELAY_MS=20 TURN_TIMEOUT_SECONDS=30 FINISHED_CLOSE_MS=60000 npm run dev
Then: python3 scripts/browser_e2e.py
"""
import os, time, json, sys
from playwright.sync_api import sync_playwright

URL = "http://localhost:2599/"
errors = []
os.makedirs("/tmp/ludo-shots", exist_ok=True)

with sync_playwright() as p:
    browser = p.chromium.launch(executable_path=os.environ.get("CHROME_PATH", "/usr/bin/google-chrome"), headless=True, args=["--no-sandbox", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"])
    page = browser.new_page(viewport={"width": 1100, "height": 760})
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.on("console", lambda m: errors.append(m.text) if m.type == "error" else None)
    page.goto(URL)
    page.screenshot(path="/tmp/ludo-shots/1_lobby.png")

    page.fill("#name", "Tester")
    page.select_option("#players", "2")
    page.click("#quick")
    page.wait_for_selector("#game", state="visible", timeout=5000)
    print("tab text:", page.inner_text("#tabs"))
    page.screenshot(path="/tmp/ludo-shots/2_waiting.png")

    page.click("#start")
    page.wait_for_function("window.__ludo.sessions[0].state && window.__ludo.sessions[0].state.phase !== 'lobby'", timeout=5000)

    def info():
        return page.evaluate("""() => {
          const s = window.__ludo.sessions[0];
          const st = s.state;
          return {phase: st.phase, myTurn: s.myTurn, mySeat: s.mySeat, legal: st.legalMoves, over: !!s.over,
                  pieces: st.players.find(p => p.seat === s.mySeat).pieces, dice: st.dice, seq: st.seq};
        }""")

    def click_piece(idx):
        pos = page.evaluate("""(idx) => {
          const s = window.__ludo.sessions[0];
          const me = s.state.players.find(p => p.seat === s.mySeat);
          return window.__ludo.piecePos(me.seat, me.pieces[idx], idx);
        }""", idx)
        scr = page.evaluate("(p) => window.__ludo.screenPos(p[0], p[1])", pos)
        if scr:
            page.mouse.click(scr[0], scr[1])
        else:
            box = page.locator("#board").bounding_box()
            page.mouse.click(box["x"] + pos[0] / 15 * box["width"], box["y"] + pos[1] / 15 * box["height"])

    shots = 0
    start = time.time()
    last_seq = -1
    rolls = moves = 0
    while time.time() - start < 150:
        i = info()
        if i["over"]:
            break
        if i["seq"] != last_seq and i["myTurn"]:
            last_seq = i["seq"]
            if i["phase"] == "roll":
                page.click("#roll", force=True)
                rolls += 1
            elif i["phase"] == "move":
                click_piece(i["legal"][0])
                moves += 1
        if shots < 2 and rolls + moves > 6 * (shots + 1):
            page.screenshot(path=f"/tmp/ludo-shots/3_playing_{shots}.png")
            shots += 1
        time.sleep(0.05)

    print("rolls clicked:", rolls, "moves clicked:", moves, "elapsed: %.1fs" % (time.time() - start))
    print("game over shown:", page.is_visible("#over"))
    page.wait_for_timeout(300)
    page.screenshot(path="/tmp/ludo-shots/4_over.png")
    print("ranking:", page.inner_text("#ranking").replace("\n", " | "))
    page.click("#closeGame")

    # up to 3 games: create 3 private rooms, 4th is refused
    for n in range(3):
        page.click("#tabs .tab:last-child") if page.locator("#tabs .tab").count() else None
        page.click("#private")
        page.wait_for_selector("#game", state="visible", timeout=5000)
    print("tabs after 3 games:", page.inner_text("#tabs").replace("\n", " | "))
    page.screenshot(path="/tmp/ludo-shots/5_three_games.png")
    print("new-game tab present with 3 games:", page.locator("#tabs .tab", has_text="New game").count())

    # server-side limit via a second browser context with the same user id
    ctx2 = browser.new_context()
    page2 = ctx2.new_page()
    page2.goto(URL)
    uid = page.evaluate("window.__ludo.userId")
    page2.evaluate("(uid) => localStorage.setItem('ludo_user_id', uid)", uid)
    page2.reload()
    page2.fill("#name", "Tester2")
    page2.click("#private")
    page2.wait_for_timeout(800)
    print("same user, second browser, 4th game ->", page2.inner_text("#error"))

    print("page errors:", errors)
    browser.close()
