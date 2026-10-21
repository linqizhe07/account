<p align="center"><img src="site/img/og.png" alt="Gravit — the airport for agents and money" width="720"></p>

# Gravit

**Your trading accounts on one page, and AI agents that trade only inside the limits you sign.**

Gravit runs on your own computer. It puts your exchanges, brokers, wallets and prediction markets on one page, gives you a paper account with live prices to practise on, and lets AI agents — its own trading desk, or yours over MCP — trade, move and pay inside limits you sign. Website: [linqizhe07.github.io/buyer-agent-demo](https://linqizhe07.github.io/buyer-agent-demo/)

## Start in five minutes

You need [Node.js](https://nodejs.org) 22 or newer and Git. Tested on macOS; Linux should work the same way; Windows is untested.

```bash
git clone https://github.com/linqizhe07/buyer-agent-demo.git
cd buyer-agent-demo
npm ci
npm run account
```

Open **http://127.0.0.1:4820** and type the pairing code the terminal printed. That browser is now the owner: everything that moves money is signed by it.

Then, on the page:

1. **Start a paper account** — $10,000 of paper money, live public prices, nothing to connect.
2. **Trade** — buy or sell crypto, US stocks, perpetuals and event contracts on paper.
3. **Superagent** (Trade → Superagent) — paste an API key and press **Start the superagent**. The desk trades your paper account by itself: every trade lands on the chart, and each step it takes is played as it happens.

The superagent needs an AI model to think with. Paste a key from any of Anthropic, OpenAI, DeepSeek, Gemini, xAI, Kimi, Qwen, OpenRouter, Groq, Together or Meta — the account tells whose key it is and picks that provider's best model — or run a model on your machine with Ollama or vLLM (no key). Its calls are billed to your key.

## Connect your real accounts

**Account → Venues → Connect an account**: 93 exchanges by API key (Coinbase, Kraken, OKX, Binance and more); Alpaca and Robinhood for US stocks; Kalshi and Polymarket; Hyperliquid; MetaMask and other wallets.

- Venue API keys go in files on your computer (`~/.buyer-agent-demo/`): the page tells you where, and the key never passes through the page or the log. An AI key you paste on the page is saved in the same folder.
- Real trading is on, capped per order or movement: `npm run account -- --live-cap 20` (default $100). `--read-only` turns trading off.

## Your network decides what you see

Gravit has no server in the middle, and no analytics: your computer reads public prices and talks to venues directly. So your network — your country, your IP, a company firewall — decides which venues answer.

- **It asks every venue from your network** and shows what serves you. A venue that refuses your network is marked *Not served here*, with its own regional edition where it has one (Binance.US, OKX US, Polymarket US). Nothing seen from anyone else's computer decides it.
- **Prices have fallbacks.** Crypto comes from Coinbase, else Kraken, else OKX; US stocks from Robinhood, else Nasdaq (Cboe's delayed quotes are shown last but never fill a paper order); perpetuals from Hyperliquid. Where no source answers, that market has no price: a paper market order is refused and a limit order waits, and the page says why.
- **It never routes around a block** — no proxies, no other hosts. To match venues' published rules to your network it asks a public location check (Polymarket's, Cloudflare's or ipapi.co's).
- **Check before you start:** `npm run account:check` prints what your network reaches, in each venue's own words. It contains no IP, place or key, so it is safe to share.

## Stay in control

- **You sign what matters.** Orders, movements and every agent's limit are signed by your browser's key; the account checks each signature.
- **Guard or Beast.** In Guard, whatever an agent asks for waits for your yes on a card. In Beast, agents act at once — but only inside the limits you signed.
- **Hard caps.** No order or movement is worth more than `--live-cap`, and money leaves a venue only for a place shown to be yours.
- **A record of everything** in a hash-chained log on your computer, and a Statement you can filter and export.

## Bring your own agent

Press **Copy setup command** (Portfolio's *Get started*, or under Agents) and run it where your agent lives (Claude Code or any MCP client). Let the agent in from the page and give it a limit: it can read your accounts and trade, move or pay inside that limit.

## Keep it running (macOS)

```bash
npm run account:service -- install --live-cap 20
```

It starts when you log in and restarts if it stops. Also `status`, `restart` (after an update), `logs`, `code` (the pairing code) and `uninstall`.

## Look around without anything real

```bash
npx tsx test/standin/ui-standin.ts --port 4821 --superagent
```

The same page with stand-in venues at http://127.0.0.1:4821 — no network, no money, no key — and a desk that trades with a script, so you can watch the superagent work before you bring a key. Use `--no-desk` instead to go through the setup yourself.

## More

- `npm run account -- --port 4825 --home ~/gravit-second` runs a second, separate account; `--fresh` starts one from nothing.
- In Chinese: [docs/README.zh.md](docs/README.zh.md) (the full description), [COOKBOOK.md](COOKBOOK.md) (recipes) and [docs/account.md](docs/account.md) (how every part works).
- `npm test` · `npm run typecheck`
- Questions and bugs: [GitHub issues](https://github.com/linqizhe07/buyer-agent-demo/issues).

Gravit is not financial advice. Real trading is at your own risk; paper money is not real money.
