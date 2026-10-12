// Public topic navigation. Synonyms belong to these canonical resources, not
// separate near-identical pages. Planned products are not advertised here.
export const TOPIC_CLUSTERS = [
  { id: 'discovery', title: 'Find and analyze memecoins', description: 'Find new launches, compare market activity and build a research record for a specific token.', pages: ['/solana-memecoin-screener', '/pump-fun-tracker', '/how-to-find-meme-coins-early', '/guides/how-to-analyze-meme-coins', '/guides/solana-memecoin-market-cap-liquidity', '/guides/pumpfun-bonding-curve'] },
  { id: 'ai-research', title: 'AI research and coin picks', description: 'Understand the inputs behind a model conclusion, compare research methods and check the evidence behind a pick.', pages: ['/ai-memecoin-picks', '/ai-memecoin-trading', '/memecoin-social-sentiment', '/guides/compare-ai-crypto-research'] },
  { id: 'wallets', title: 'Wallet tracking and PnL', description: 'Investigate public wallet activity, distinguish realized and open results, and evaluate smart-money candidates.', pages: ['/solana-wallet-tracker', '/solana-pnl-tracker', '/guides/how-to-find-smart-money-wallets'] },
  { id: 'risk', title: 'Holders and token risk', description: 'Interpret holder concentration, early-buyer observations and incomplete risk data.', pages: ['/memecoin-risk-scanner', '/guides/token-holder-distribution'] },
  { id: 'trading', title: 'Trading, practice and alerts', description: 'Learn the terminal workflow, test ideas in paper trading and interpret alerts before acting.', pages: ['/solana-trading-terminal', '/memecoin-paper-trading', '/memecoin-alerts'] },
  { id: 'creation', title: 'Create a memecoin', description: 'Prepare your token metadata and understand the account, funding and transaction steps of a launch.', pages: ['/create-memecoin'] },
  { id: 'developers', title: 'APIs, live data and MCP', description: 'Understand data interfaces, stream events and AI-client tools, with clear account and provider boundaries.', pages: ['/api', '/trade-api', '/pump-fun-api', '/pumpfun-realtime-api', '/mcp', '/axiom-api', '/fomo-api', '/gmgn-api', '/pump-fun-trading-api', '/gmgn-trading-api', '/axiom-trading-api', '/fomo-trading-api', '/photon-trading-api', '/bullx-trading-api', '/jupiter-trading-api'] },
  { id: 'comparisons', title: 'Compare platforms and alternatives', description: 'Compare a specific workflow using documented capabilities, current availability and explicit unknowns.', pages: ['/compare', '/compare/axiom-alternative', '/compare/fomo-alternative', '/compare/nio-trade-alternative', '/compare/bullx-alternative', '/compare/gmgn-alternative', '/compare/dexscreener-alternative', '/compare/birdeye-alternative', '/compare/jupiter-terminal-alternative', '/compare/solana-terminal-comparison'] },
];

// Newly published resources from the parallel release are retained and placed
// by task. Exact-intent duplicates below redirect to the established resource.
const additional = {
  discovery: ['/pump-fun', '/pump-fun-analytics', '/meme-coin-finder', '/new-meme-coins', '/trending-meme-coins', '/meme-coin-analyzer', '/memecoin-analytics', '/solana-memecoins'],
  'ai-research': ['/grok-meme-coin-picks', '/claude-crypto-analysis', '/chatgpt-meme-coin-analysis', '/gemini-crypto-picks', '/deepseek-meme-coin-picks', '/best-ai-for-crypto-trading', '/best-crypto-ai-tools', '/twitter-meme-coin-tracker', '/memecoin-narratives', '/how-to-use-ai-for-crypto-trading'],
  wallets: ['/pump-fun-wallet-tracker', '/smart-money-tracker', '/solana-whale-tracker', '/how-to-track-solana-wallets'],
  risk: ['/pump-fun-rug-checker', '/rug-pull-scanner'],
  trading: ['/pump-fun-trading-bot', '/pump-fun-terminal', '/pump-fun-signals', '/ai-trading-bot', '/ai-trading-agent', '/solana-swap'],
  creation: ['/create-pump-fun-coin', '/ai-meme-coin-maker', '/meme-coin-name-generator', '/how-to-create-a-meme-coin'],
  developers: ['/pump-fun-mcp', '/pump-fun-sdk', '/pump-fun-api-python', '/pump-fun-api-javascript', '/developers', '/crypto-mcp-server', '/how-to-use-mcp-for-crypto', '/solana-api', '/wallet-tracking-api', '/memecoin-sdk', '/crypto-trading-cli', '/how-to-build-a-solana-trading-bot', '/fomo-mcp', '/axiom-mcp', '/nio-trade-api'],
  comparisons: ['/pump-fun-vs-letsbonk', '/pump-fun-vs-moonshot', '/pump-fun-vs-raydium', '/best-solana-trading-terminal', '/fomo-app', '/fomo-trading-bot', '/fomo-scanner', '/axiom-trade', '/axiom-trading-bot', '/axiom-scanner', '/nio-trade', '/photon-alternative', '/axiom-vs-fomo', '/axiom-vs-bullx', '/axiom-vs-photon', '/axiom-vs-gmgn', '/fomo-vs-bullx'],
};
for (const topic of TOPIC_CLUSTERS) topic.pages.push(...additional[topic.id]);

export const PAGE_ALIASES = Object.freeze({
  '/memecoin-scanner': '/solana-memecoin-screener',
  '/solana-token-scanner': '/solana-memecoin-screener',
  '/meme-coin-scanner': '/solana-memecoin-screener',
  '/pump-fun-scanner': '/pump-fun-tracker',
  '/memecoin-signals': '/memecoin-alerts',
  '/pump-fun-websocket': '/pumpfun-realtime-api',
  '/memecoin-mcp-server': '/mcp',
  '/memecoin-api': '/api',
  '/bullx-alternative': '/compare/bullx-alternative',
  '/gmgn-alternative': '/compare/gmgn-alternative',
  '/dexscreener-alternative': '/compare/dexscreener-alternative',
  '/birdeye-alternative': '/compare/birdeye-alternative',
  '/jupiter-terminal-alternative': '/compare/jupiter-terminal-alternative',
  '/how-to-analyze-meme-coins': '/guides/how-to-analyze-meme-coins',
  '/pumpfun-api': '/pump-fun-api',
  '/solana-mcp': '/mcp',
  '/axiom-alternative': '/compare/axiom-alternative',
  '/ai-meme-coin-picks': '/ai-memecoin-picks',
  '/pumpportal-alternative': '/pump-fun-trading-api',
  '/pump-fun-trade-api': '/trade-api',
  '/solana-trade-api': '/trade-api',
  '/solana-trading-api': '/trade-api',
  '/memecoin-trading-api': '/trade-api',
});

export const PAGE_TOPIC = new Map(TOPIC_CLUSTERS.flatMap(topic => topic.pages.map(page => [page, topic])));
export const canonicalLinks = html => html.replace(/href="(\/[^"?#]*)([^\"]*)"/g, (match, pathname, suffix) => PAGE_ALIASES[pathname] ? `href="${PAGE_ALIASES[pathname]}${suffix}"` : match);
