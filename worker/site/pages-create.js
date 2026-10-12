// Coin creation pages: launching a pump.fun coin from BLIX, the AI angle, the name and ticker generator (a real tool,
// in the page, no account needed to try it; the launch needs one), and the how-to guide.
import { F, FACT, START, DISCORD, DISCORD_LINK, COMMUNITY, NOT_AFFILIATED, RISK, CHECKED, code, table, facts, steps, bullets, callout, links, page } from "./pagekit.js";

const CREATE_MORE = links("More on creating coins", [
  ["/create-pump-fun-coin", "Create a pump.fun coin", "Launch from one screen with your Blix wallet."],
  ["/ai-meme-coin-maker", "AI meme coin maker", "What the AI does for a launch, honestly."],
  ["/meme-coin-name-generator", "Meme coin name generator", "Names, tickers and taglines, instantly."],
  ["/how-to-create-a-meme-coin", "How to create a meme coin", "The whole process, step by step."],
  ["/create-memecoin", "Create a memecoin on BLIX", "The launcher, field by field."],
  ["/pump-fun", "pump.fun explained", "The curve, the fees, graduation."],
]);
const LAUNCH_FACTS = [["Where", "pump.fun, from your BLIX account"], ["Cost", "Free to create; about 0.025 SOL of network fees with a first buy"], ["Needs", "Picture, name, ticker, a line about it; links and a first buy optional"], ["Rewards", "pump.fun's creator fee on every trade, shown and claimable in BLIX"], ["Time", "About a minute"], FACT.community];

// ---------- /create-pump-fun-coin ----------
const createPump = page({
  path: "/create-pump-fun-coin", crumb: "Create a pump.fun coin", eyebrow: `pump.fun launcher · checked ${CHECKED}`,
  title: "Create a pump.fun Coin in One Screen: Launcher, Fees, Rewards | BLIX",
  description: "Launch a pump.fun coin from BLIX in about a minute: picture, name, ticker, links, an optional first buy, the curve previewed, creator fees claimable.",
  h1: "Create a pump.fun coin from BLIX",
  lede: `A pump.fun coin takes a picture, a name, a ticker and a line about it. BLIX's Create page takes those, shows you the coin as it will look, what it costs, where it starts on the bonding curve after your first buy and what people are posting about right now, then signs the launch from your Blix wallet. From then on the coin is on your own terminal's Pulse with its holders, chart and rug check, and every trade on it pays you pump.fun's creator fee, which BLIX shows and lets you claim. Create an account and the launcher is in the sidebar.`,
  body: `${START("Create your account and launch")}
${facts(LAUNCH_FACTS)}
${F.launch("What the Create page does")}
<h2 id="steps">Launch in six steps</h2>
${steps([
    "Sign in with Google. BLIX makes you a Solana wallet; deposit a little SOL (the create costs about 0.025 SOL in network fees with a first buy, plus whatever you want to buy).",
    "Open <b>Create</b>. Upload the picture (square, PNG, JPG, GIF or WebP; big phone photos are resized for you).",
    "Name and ticker. A ticker is suggested from the name; up to 10 letters and numbers, no spaces.",
    "A line about the coin, and optional X, Telegram and website links (type <code>@handle</code> and BLIX makes the link).",
    "Optional first buy: 0.1, 0.25, 0.5 or 1 SOL with a slippage you pick. The preview shows where the coin starts on the curve and what share you will hold; a dev holding above 5% is a red flag on most terminals, and the page says so.",
    "Launch. The vault signs the create from your wallet, the coin appears on Pulse, and the Create page starts showing your creator rewards.",
  ])}
<h2 id="fees">What it costs, and what it pays</h2>
${table(["", "Amount"], [
    ["Creating the coin", "Free on pump.fun; about 0.025 SOL of Solana network fees when the create includes a first buy"],
    ["Your first buy", "Whatever you choose, filled on the curve at launch"],
    ["Trading on the curve", "1.25% a trade, of which 0.30% goes to the creator: you"],
    ["After graduation", "Creator fees continue on PumpSwap per pump.fun's current schedule"],
    ["Claiming", "From the Create page in BLIX, to your Blix wallet"],
  ])}
<h2 id="after">After the launch</h2>
<p>Your coin is a coin like any other on BLIX: its holders, bundles and snipers are visible to everyone, its rating updates as it trades, and known traders' faces show up on its chart. That transparency is the point. A fair launch with a real story and a dev who does not dump is what the rug check rewards. Share the coin's page, your @handle page and the Discord, and let the chart do the talking.</p>
${F.holders("What buyers will see about your coin")}
${COMMUNITY}
${CREATE_MORE}
${NOT_AFFILIATED("pump.fun")}${RISK}`,
  faq: [
    ["How much does it cost to create a pump.fun coin?", `pump.fun charges nothing to create; Solana's network fee is about 0.025 SOL when the create includes a first buy. On BLIX you also choose whether to make a first buy, from 0.1 SOL up.`],
    ["Do I need a wallet to launch?", `BLIX makes you one when you sign up. Deposit SOL to it and the Create page is ready; you can export the key or withdraw at any time.`],
    ["Can I launch a coin automatically or in one click?", `The launch is one form and one button, but every field is yours: the picture, the name, the ticker, the line. BLIX does not launch coins on its own.`],
    ["Do I earn creator rewards on BLIX launches?", `Yes. pump.fun pays the creator a share of every trade; BLIX shows what your coins have earned and lets you claim it to your wallet.`],
    ["Is there a pump.fun token creator without a website?", `BLIX is the website. There is no separate tool to install; the launcher is in your account.`],
  ],
});

// ---------- /ai-meme-coin-maker ----------
const aiMaker = page({
  path: "/ai-meme-coin-maker", crumb: "AI meme coin maker",
  title: "AI Meme Coin Maker: What AI Actually Does for a Launch (2026) | BLIX",
  description: "An honest AI meme coin maker: BLIX's AI tells you which narratives are running, a generator gives names and tickers, and the launcher puts the coin on pump.fun.",
  h1: "AI meme coin maker, honestly",
  lede: `Search "AI meme coin maker" and you will find tools that promise a coin from one prompt. Here is what AI is actually good for in a launch, and what BLIX does: the AI reads X and the chain all day and tells you which narratives are running and what people are posting about right now, so you launch into a story instead of a vacuum; a generator gives you names, tickers and taglines in a second; and the launcher puts the coin on pump.fun from one screen with your Blix wallet. What BLIX does not do is draw your picture: that part is yours, and it is the part that matters.`,
  body: `${START("Create your account")}
${facts([["AI", "Narratives and runners written up daily; what people are posting right now, on the Create page"], ["Names", "A name, ticker and tagline generator, in the browser"], ["Launcher", "pump.fun in one screen, from your Blix wallet"], ["Picture", "Yours: upload it; the preview shows how it will look"], ["After", "Holders, chart, rating and creator rewards on your own terminal"], FACT.community])}
<h2 id="ai-does">What the AI does for a launch</h2>
${table(["Step", "What BLIX's AI gives you"], [
    ["Pick a story", "The Today desk explains the narratives running and the day's runners, researched on X and the web. The Create page shows what people are posting about right now."],
    ["Avoid the copies", "Every coin row shows how many same-ticker launches happened this hour. The eleventh \"BONK2\" is not a story."],
    ["Name it", "The generator below makes names, tickers and taglines from a word; the launcher suggests a ticker from the name."],
    ["Set the first buy", "The curve preview shows where the coin starts and what share you hold; the page warns when a dev share would look bad to buyers."],
    ["After launch", "The same rating, holder panel and rug check every other coin gets, so buyers can see your launch is fair."],
  ])}
<h2 id="not">What it does not do</h2>
<p>BLIX does not generate the picture, write a website or post for you, and it does not launch coins on its own. Tools that promise a complete coin from one prompt produce coins that look like every other prompt's coin, and buyers can tell. The launch is a form; the AI's job is the research around it.</p>
${F.narratives("The research: narratives, written up daily")}
${F.launch("The launcher")}
<h2 id="generator">Names and tickers</h2>
<p>The <a href="/meme-coin-name-generator">meme coin name generator</a> makes eight names, tickers and taglines from any word, instantly, in your browser. Take one to the Create page, or let it spark a better one.</p>
${COMMUNITY}
${CREATE_MORE}
${NOT_AFFILIATED("pump.fun")}${RISK}`,
  faq: [
    ["Can AI create a meme coin for me?", `It can tell you what story to launch into, give you names and tickers, and the launcher puts the coin on pump.fun in one screen. The picture and the decision are yours; BLIX does not launch coins on its own.`],
    ["Does BLIX generate meme coin logos?", `No. Upload your own picture; the Create page previews it and resizes big photos for you.`],
    ["Is there an AI pump.fun creator?", `BLIX is the closest honest version: AI research on what is running, a name generator, and a one-screen pump.fun launcher from your account.`],
    ["Is it free?", `The account is free; the launch costs Solana's network fee (about 0.025 SOL with a first buy) and whatever you choose to buy.`],
  ],
});

// ---------- /meme-coin-name-generator ----------
// A working generator in the page: plain JavaScript, no account needed to use it, no network calls. index.js hashes
// the inline script for the page's CSP. The words are generic memecoin vocabulary; the fun is in the combinations.
const GEN_HTML = `<div class="gen">
<label for="g-word">A word to build on (optional)</label>
<div class="gen-row"><input id="g-word" type="text" maxlength="24" placeholder="cat, pepe, retro, your dog's name…" autocomplete="off"><button id="g-go" class="btn primary" type="button">Generate names</button></div>
<div id="g-out" class="gen-out" aria-live="polite"></div>
<p class="note">Made in your browser from memecoin vocabulary: no AI, no account, nothing sent anywhere. Check the ticker on BLIX before you launch: the Pulse row shows how many coins with the same ticker launched this hour.</p>
</div>
<style>.gen{margin:18px 0 8px}.gen label{display:block;font-size:.8125rem;color:var(--muted);margin:0 0 6px}.gen-row{display:flex;gap:8px;flex-wrap:wrap;margin:0 0 14px}.gen-row input{flex:1;min-width:200px;font:400 1rem/1 var(--body);padding:11px 12px;border-radius:6px;border:1px solid var(--rule-2);background:var(--paper-3);color:var(--ink)}.gen-row input:focus{outline:2px solid var(--focus);outline-offset:1px}.gen-out{display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:10px}.gen-card{background:var(--paper-3);border:1px solid var(--rule);border-radius:8px;padding:12px 14px}.gen-card b{display:block;font:600 1.0625rem/1.3 var(--display);letter-spacing:-.01em}.gen-card .tk{font:500 .8125rem/1.6 var(--mono);color:var(--accent)}.gen-card p{font-size:.875rem;margin:6px 0 8px;color:var(--ink-2)}.gen-card .sl{font-size:.8125rem;color:var(--muted);font-style:italic}.gen-card .acts{display:flex;gap:6px;margin-top:8px}.gen-card button,.gen-card a{font:600 .75rem/1 var(--body);padding:6px 9px;border-radius:6px;border:1px solid var(--rule-2);background:var(--paper-4);color:var(--ink);cursor:pointer}.gen-card a{text-decoration:none}</style>`;
const GEN_SCRIPT = `(function(){
var A=["Baby","Giga","Mega","Turbo","Chad","Based","Moon","Degen","Sigma","Hyper","Ultra","Quantum","Pixel","Retro","Cosmic","Lazy","Angry","Sleepy","Golden","Tiny","Fat","Wet","Smol","Big","Rich","Broke","Sad","Happy","Silly","Spicy","Frozen","Electric","Ancient","Future","Space","Jungle","Desert","Neon","Crypto","Solana"];
var N=["Cat","Dog","Frog","Pepe","Doge","Whale","Ape","Goat","Penguin","Hamster","Capybara","Rat","Duck","Shark","Bull","Bear","Wizard","Knight","Alien","Robot","Pickle","Potato","Banana","Toast","Noodle","Sock","Nugget","Bean","Pumpkin","Cactus","Dragon","Goose","Otter","Sloth","Pigeon","Raccoon","Moth","Snail","Worm","Walrus","Llama","Owl"];
var S=["Coin","Inu","wif Hat","Fi","zilla","Moon","Rocket","Cult","Gang","DAO","2.0","Mode","Lord","King","Queen","Boss","Army","Club","World","Land","Mania","Season","Index","Protocol","Labs","Maxi","Punk","Pass","Pal","Bot"];
var D=["is the {n} of Solana. No roadmap, no utility, just {n}.","{n} does nothing and that is the point.","One billion {n}, one chart, one community.","The first {n} on pump.fun that actually {v}.","{n} has entered the chat. Fair launch, no presale, no team tokens.","Built different. {n} {v} while you sleep.","Every chain has a {n}. This is Solana's.","{n}. That's it. That's the coin."];
var V=["moons","bonds","vibes","ships","grinds","holds the line","refuses to rug","touches grass"];
var L=["Buy the {n}. Be the {n}.","In {n} we trust.","{n} to the moon, or to zero. Probably both.","Not financial advice. Definitely {n}.","wen {n}? now {n}.","{n} season is every season.","Ape responsibly. Or don't.","The {n} always wins."];
function pick(a){return a[Math.floor(Math.random()*a.length)]}
function cap(s){s=String(s).trim();return s?s.charAt(0).toUpperCase()+s.slice(1):""}
function ticker(name){var w=name.replace(/[^A-Za-z0-9 ]/g,"").split(/\\s+/).filter(Boolean),t="";if(w.length>=2){t=w.map(function(x){return x.slice(0,Math.ceil(5/w.length))}).join("")}else{t=w[0]||"MEME";if(t.length>5)t=t.replace(/[aeiou]/gi,"").slice(0,5)||t.slice(0,5)}t=t.toUpperCase().slice(0,6);return "$"+(t||"MEME")}
function names(word){var out=[],seen={},base=cap(word);for(var i=0;i<40&&out.length<8;i++){var kind=Math.random(),n;if(base){n=[base+" "+pick(N),pick(A)+" "+base,base+" "+pick(S),base.toLowerCase()+pick(S).toLowerCase().replace(/\\s/g,""),pick(A)+" "+base+" "+pick(S)][Math.floor(Math.random()*5)]}else{n=kind<.35?pick(A)+" "+pick(N):kind<.7?pick(N)+" "+pick(S):pick(A)+" "+pick(N)+" "+pick(S)}if(seen[n])continue;seen[n]=1;var subj=base||n.split(" ")[Math.min(1,n.split(" ").length-1)];out.push({name:n,tk:ticker(n),d:pick(D).replace(/\\{n\\}/g,subj).replace(/\\{v\\}/g,pick(V)),l:pick(L).replace(/\\{n\\}/g,subj)})}return out}
function esc(s){return String(s).replace(/[&<>"]/g,function(c){return{"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]})}
function render(){var w=document.getElementById("g-word").value,o=document.getElementById("g-out");o.innerHTML=names(w).map(function(c){var txt=c.name+" ("+c.tk+")\\n"+c.d+"\\n"+c.l;return '<div class="gen-card"><b>'+esc(c.name)+'</b><span class="tk">'+esc(c.tk)+'</span><p>'+esc(c.d)+'</p><div class="sl">'+esc(c.l)+'</div><div class="acts"><button type="button" data-copy="'+esc(txt)+'">Copy</button><a href="/start">Launch on BLIX</a></div></div>'}).join("")}
document.getElementById("g-go").addEventListener("click",render);
document.getElementById("g-word").addEventListener("keydown",function(e){if(e.key==="Enter"){e.preventDefault();render()}});
document.getElementById("g-out").addEventListener("click",function(e){var b=e.target.closest("button[data-copy]");if(!b)return;navigator.clipboard.writeText(b.getAttribute("data-copy")).then(function(){b.textContent="Copied";setTimeout(function(){b.textContent="Copy"},1400)})});
render();
})();`;
const generator = page({
  path: "/meme-coin-name-generator", crumb: "Name generator",
  title: "Meme Coin Name Generator: Names, Tickers & Taglines | BLIX",
  description: "Free meme coin name generator: type a word and get eight coin names with tickers, one-line descriptions and taglines, instantly in your browser.",
  h1: "Meme coin name generator",
  lede: `Type a word (your dog, a meme, a mood) or leave it blank, and get eight meme coin names with a ticker, a one-line description and a tagline each. It runs in your browser, instantly, with nothing sent anywhere. When one of them lands, the Create page on BLIX takes it to pump.fun in one screen.`,
  body: `${GEN_HTML}
<script>${GEN_SCRIPT}</script>
${START("Launch it on BLIX")}
<h2 id="good">What makes a meme coin name work</h2>
${bullets([
    "<b>One word people already say.</b> The best names are a thing people were going to say anyway: a meme, an animal, a word from the week's story.",
    "<b>A ticker you can type.</b> Three to six letters, no numbers unless the number is the joke. BLIX suggests one from the name and shows how many coins with the same ticker launched this hour; if it is eleven, pick another.",
    "<b>A tagline that is the whole pitch.</b> If it needs a paragraph it is a product, not a memecoin.",
    "<b>A picture that matches.</b> The name generator does not make it; you do, and it is most of the coin.",
  ])}
<h2 id="check">Check the name before you launch</h2>
<p>Search the ticker on BLIX: if a coin with that name already ran, yours is a copy, and copies are what the same-ticker counter on every row is for. Search X for the word: a name that is already a conversation launches into buyers.</p>
${F.launch("From name to launch")}
${COMMUNITY}
${CREATE_MORE}
${RISK}`,
  faq: [
    ["Is the meme coin name generator free?", `Yes, and it needs no account. It runs in your browser from memecoin vocabulary; nothing is sent anywhere.`],
    ["Does it generate tickers and descriptions too?", `Yes: every name comes with a ticker, a one-line description and a tagline. The ticker is suggested again on the Create page from whatever name you type.`],
    ["Is it AI?", `No. It is a word generator; the AI on BLIX is used for research (narratives, ratings, picks), not for naming. The combinations are the fun part.`],
    ["Can I launch a coin from here?", `Create a BLIX account and the Create page launches it on pump.fun in one screen from your Blix wallet.`],
  ],
});

// ---------- /how-to-create-a-meme-coin ----------
const howTo = page({
  path: "/how-to-create-a-meme-coin", crumb: "How to create a meme coin", eyebrow: `Guide · checked ${CHECKED}`,
  title: "How to Create a Meme Coin on Solana in 2026 (pump.fun) | BLIX",
  description: "How to create a meme coin on Solana in 2026: story, name, ticker, picture, the pump.fun launch from BLIX in one screen, fees, creator rewards, what buyers check.",
  h1: "How to create a meme coin on Solana",
  lede: `Creating a meme coin on Solana takes about a minute on pump.fun and costs almost nothing. Making one that people buy takes a story, a name, a picture and a fair launch. This guide covers both halves as of ${CHECKED}: what to decide before you launch, how the launch works from BLIX's Create page, what it costs and pays, and what buyers will see about your coin the moment it exists.`,
  body: `${START("Create your account")}
${facts(LAUNCH_FACTS)}
<h2 id="before">Before you launch</h2>
${steps([
    "<b>The story.</b> A memecoin is a joke, a moment or a mascot people already want to share. BLIX's Today desk shows which narratives are running and the Create page shows what people are posting right now; launch into a conversation, not a vacuum.",
    "<b>The name and ticker.</b> One word people say, a ticker of three to six letters. The <a href=\"/meme-coin-name-generator\">name generator</a> gives you eight to start from; BLIX shows how many coins with the same ticker launched this hour.",
    "<b>The picture.</b> Square, clear at 48 pixels, yours. It is most of the coin.",
    "<b>The links.</b> An X account at least; Telegram and a site if you have them. Buyers click them before they buy.",
    "<b>Your own buy.</b> Decide the first buy in advance. A dev holding above about 5% is a red flag on every terminal, including BLIX, and buyers look.",
  ])}
<h2 id="launch-on-blix">The launch, on BLIX</h2>
${F.launch("The Create page")}
<h2 id="costs">What it costs and what it pays</h2>
${table(["", "Amount"], [
    ["Creating on pump.fun", "Free; about 0.025 SOL of network fees with a first buy"],
    ["Curve trading fee", "1.25% a trade: 0.95% to pump.fun, 0.30% to you as the creator"],
    ["Graduation", "0.015 SOL when the curve completes (about 411 SOL of market cap)"],
    ["Creator rewards", "Shown on the Create page and claimable to your Blix wallet"],
  ])}
<h2 id="after">What buyers will check</h2>
<p>Every terminal, BLIX included, shows your coin's holders from the first trade: your share, whether you sold, wallets that bought in the first block (bundles) or the first two blocks (snipers), the top-10 share, and whether your wallet has launched other coins. A fair launch passes the rug check in one number; a bundled one fails it in front of everyone. The chart shows known traders' faces where they bought. Make the setup clean and the data sells the coin for you.</p>
<h2 id="not">What BLIX does not do</h2>
<p>It does not draw the picture, write a website or a tweet, or launch coins on its own. It gives you the research, the name generator, the one-screen launcher and the terminal where your coin lives afterwards.</p>
${F.holders("Your coin, as buyers see it")}
${COMMUNITY}
${CREATE_MORE}
${NOT_AFFILIATED("pump.fun")}${RISK}`,
  faq: [
    ["How much does it cost to create a meme coin on Solana?", `On pump.fun, nothing but Solana's network fee (about 0.025 SOL when the create includes a first buy). Trades on the curve pay 1.25%, of which 0.30% comes back to you as the creator.`],
    ["Do I need to code to make a meme coin?", `No. pump.fun's curve handles the token; BLIX's Create page is one form: picture, name, ticker, description, links, optional first buy.`],
    ["How do I make a meme coin with AI?", `Use the AI for the research (which narratives are running, what people are posting) and the generator for names; launch from the Create page. See <a href="/ai-meme-coin-maker">AI meme coin maker</a>.`],
    ["How do I launch a meme coin on pump.fun from BLIX?", `Sign in, deposit a little SOL, open Create, fill the form, launch. The coin appears on your Pulse within seconds.`],
    ["Can I create a Solana token that is not on pump.fun?", `BLIX's launcher is pump.fun only. Coins launched elsewhere still show on BLIX once they trade on a pool Jupiter routes.`],
  ],
});

export const CREATE_PAGES = [createPump, aiMaker, generator, howTo];
