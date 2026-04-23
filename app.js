document.addEventListener('DOMContentLoaded', () => {
    const searchBtn = document.getElementById('search-btn');
    const addressInput = document.getElementById('address-input');
    const errorMsg = document.getElementById('error-message');
    const loadingState = document.getElementById('loading-state');
    const dashboard = document.getElementById('wallet-dashboard');

    // UI Elements for Data
    const elBalBtc = document.getElementById('bal-btc');
    const elBalUsd = document.getElementById('bal-usd');
    const elTotRecv = document.getElementById('tot-recv');
    const elTotSent = document.getElementById('tot-sent');
    const elTxCount = document.getElementById('tx-count');
    const txList = document.getElementById('tx-list');
    const viewAllLink = document.getElementById('view-all-link');

    let currentBtcPrice = 0;

    // Fetch initial Bitcoin price
    fetchBtcPrice();

    searchBtn.addEventListener('click', handleSearch);
    addressInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') handleSearch();
    });

    async function fetchBtcPrice() {
        try {
            // Priority 1: CoinCap
            const res = await fetch('https://api.coincap.io/v2/assets/bitcoin');
            const data = await res.json();
            currentBtcPrice = parseFloat(data.data.priceUsd);
        } catch (err) {
            console.error('Failed to fetch BTC price from CoinCap, trying fallback...', err);
            try {
                // Priority 2: Blockchain.info
                const res2 = await fetch('https://blockchain.info/ticker');
                const data2 = await res2.json();
                currentBtcPrice = data2.USD.last;
            } catch (e) {
                console.error('All price APIs failed');
            }
        }
    }

    async function handleSearch() {
        const address = addressInput.value.trim();
        if (!address) {
            showError('Please enter a valid Bitcoin address or xpub.');
            return;
        }

        hideError();
        dashboard.classList.add('dashboard-hidden');
        loadingState.classList.remove('hidden');

        try {
            const isXpub = /^[xyzu]pub/i.test(address);

            if (isXpub) {
                await processXpub(address);
            } else {
                await processAddress(address);
            }

            loadingState.classList.add('hidden');
            dashboard.classList.remove('dashboard-hidden');
            
        } catch (error) {
            loadingState.classList.add('hidden');
            showError(`<i class="fa-solid fa-circle-exclamation"></i> ${error.message}`);
        }
    }

    async function processAddress(address) {
        // Fetch Address Stats
        const addrRes = await fetch(`https://mempool.space/api/address/${address}`);
        if (!addrRes.ok) {
            if (addrRes.status === 400 || addrRes.status === 404) {
                throw new Error('Invalid address or not found. Please double check.');
            }
            throw new Error('Network error connecting to Mempool.space API.');
        }
        const addrData = await addrRes.json();

        // Fetch Recent TXs
        const txRes = await fetch(`https://mempool.space/api/address/${address}/txs`);
        const txData = txRes.ok ? await txRes.json() : [];

        populateDashboardMempool(address, addrData, txData);
    }

    async function processXpub(xpub) {
        const isElectron = /Electron/i.test(navigator.userAgent);
        const trezorUrl = `https://btc1.trezor.io/api/v2/xpub/${xpub}?details=txs`;
        const blockchairUrl = `https://api.blockchair.com/bitcoin/dashboards/xpub/${xpub}?limit=10`;

        // Case A: Desktop App (Electron) - Direct fetch with spoofed headers
        if (isElectron) {
            try {
                const res = await fetch(trezorUrl, { headers: { 'Accept': 'application/json' } });
                if (res.ok) {
                    const data = await res.json();
                    if (!data.error) {
                        populateDashboardXpub(data);
                        return;
                    }
                }
            } catch (e) {
                console.warn('Desktop Trezor fetch failed, trying fallbacks...', e);
            }
        }

        // Case B: Web Version or Desktop Fallback
        // 1. Try Blockchair first in Web (often has better CORS for public data)
        try {
            console.log('Trying Blockchair API...');
            const res = await fetch(blockchairUrl);
            if (res.ok) {
                const raw = await res.json();
                if (raw.data && raw.data[xpub]) {
                    const normalized = normalizeBlockchairData(xpub, raw.data[xpub]);
                    populateDashboardXpub(normalized);
                    return;
                }
            }
        } catch (e) {
            console.warn('Blockchair fallback failed:', e);
        }

        // 2. Try Trezor and Electrum through multiple proxies
        const electrumUrl = `https://blockbook.electrum.org/api/v2/xpub/${xpub}?details=txs`;
        
        const proxies = [
            `https://api.allorigins.win/get?url=${encodeURIComponent(trezorUrl)}`, 
            `https://api.allorigins.win/get?url=${encodeURIComponent(electrumUrl)}`,
            `https://corsproxy.io/?url=${encodeURIComponent(trezorUrl)}`,
            `https://corsproxy.io/?url=${encodeURIComponent(electrumUrl)}`,
            `https://api.codetabs.com/v1/proxy/?quest=${encodeURIComponent(trezorUrl)}`
        ];

        for (let i = 0; i < proxies.length; i++) {
            try {
                console.log(`Trying Trezor through proxy ${i + 1}...`);
                const res = await fetch(proxies[i]);
                if (!res.ok) continue;

                let data;
                if (proxies[i].includes('allorigins')) {
                    const wrapper = await res.json();
                    if (!wrapper.contents) continue;
                    data = JSON.parse(wrapper.contents);
                } else {
                    const text = await res.text();
                    if (text.trim().startsWith('<')) {
                        console.warn(`Proxy ${i + 1} returned HTML instead of JSON. Skipping.`);
                        continue;
                    }
                    data = JSON.parse(text);
                }

                if (data && !data.error) {
                    populateDashboardXpub(xpub, data);
                    return;
                }
            } catch (err) {
                console.warn(`Proxy ${i + 1} failed:`, err);
            }
        }
        
        throw new Error(`Failed to fetch wallet data. The APIs are currently rate-limited or blocked in the browser. Please try again in 10 minutes or use the Desktop version.`);
    }

    function normalizeBlockchairData(xpub, data) {
        // Map Blockchair schema to a Blockbook-like schema for populateDashboardXpub
        const dash = data.dashboard;
        return {
            balance: dash.balance.toString(),
            unconfirmedBalance: "0", 
            totalReceived: dash.received.toString(),
            totalSent: dash.sent.toString(),
            txs: dash.transaction_count,
            transactions: data.transactions.map(tx => ({
                txid: tx.hash,
                confirmations: tx.block_id > 0 ? 10 : 0,
                blockTime: new Date(tx.time).getTime() / 1000,
                fees: tx.fee.toString(),
                vin: [], 
                vout: [],
                // We use Blockchair's balance_change directly
                _blockchairBalanceChange: tx.balance_change 
            }))
        };
    }

    function populateDashboardMempool(address, stats, txData) {
        const chain = stats.chain_stats;
        const mempool = stats.mempool_stats;

        const fundedSats = chain.funded_txo_sum + mempool.funded_txo_sum;
        const spentSats = chain.spent_txo_sum + mempool.spent_txo_sum;
        const balanceSats = fundedSats - spentSats;
        
        const txCountCount = chain.tx_count + mempool.tx_count;

        updateDashboardHeaderUI(balanceSats, fundedSats, spentSats, txCountCount);
        viewAllLink.href = `https://mempool.space/address/${address}`;

        // Populate Transactions
        txList.innerHTML = '';
        if (txData && txData.length > 0) {
            // Show up to 10 recent TXs
            const recentTxs = txData.slice(0, 10);
            recentTxs.forEach(tx => {
                const isConfirmed = tx.status.confirmed;
                // Calculate net balance change for this address specifically
                let netChangeSats = 0;
                
                // Sum inputs matching our address to see what we sent
                tx.vin.forEach(vin => {
                    if (vin.prevout && vin.prevout.scriptpubkey_address === address) {
                        netChangeSats -= vin.prevout.value;
                    }
                });

                // Sum outputs matching our address to see what we received
                tx.vout.forEach(vout => {
                    if (vout.scriptpubkey_address === address) {
                        netChangeSats += vout.value;
                    }
                });

                renderTxItem(tx.txid, netChangeSats, tx.fee, isConfirmed, isConfirmed ? tx.status.block_time : null, `https://mempool.space/tx/${tx.txid}`);
            });
        } else {
            txList.innerHTML = '<div class="empty-txs">No transactions found for this address.</div>';
        }
    }

    function populateDashboardXpub(xpub, data) {
        const balSats = parseInt(data.balance) + (parseInt(data.unconfirmedBalance) || 0);
        const recvSats = parseInt(data.totalReceived);
        const sentSats = parseInt(data.totalSent);
        const txCount = data.txs;
        
        updateDashboardHeaderUI(balSats, recvSats, sentSats, txCount);
        
        // Link to explorer
        viewAllLink.href = `https://btc1.trezor.io/xpub/${xpub}`;

        // Populate Transactions
        txList.innerHTML = '';
        if (data.transactions && data.transactions.length > 0) {
            const recentTxs = data.transactions.slice(0, 10);
            recentTxs.forEach(tx => {
                const isConfirmed = tx.confirmations > 0;
                let netChangeSats = 0;
                
                // If it's from Blockchair, use the pre-calculated balance change
                if (tx._blockchairBalanceChange !== undefined) {
                    netChangeSats = tx._blockchairBalanceChange;
                } else {
                    // Standard Blockbook logic
                    if (tx.vin) tx.vin.forEach(vin => {
                        if (vin.isOwn) netChangeSats -= (parseInt(vin.value) || 0);
                    });
                    
                    if (tx.vout) tx.vout.forEach(vout => {
                        if (vout.isOwn) netChangeSats += (parseInt(vout.value) || 0);
                    });
                }
                
                renderTxItem(tx.txid, netChangeSats, parseInt(tx.fees), isConfirmed, tx.blockTime, `https://mempool.space/tx/${tx.txid}`);
            });
        } else {
            txList.innerHTML = '<div class="empty-txs">No transactions found for this master key.</div>';
        }
    }

    function updateDashboardHeaderUI(balanceSats, receivedSats, sentSats, txCount) {
        // Convert SATS to BTC (1 BTC = 100,000,000 SATS)
        const balanceBtc = (balanceSats / 100000000).toFixed(8);
        const receivedBtc = (receivedSats / 100000000).toFixed(8);
        const sentBtc = (sentSats / 100000000).toFixed(8);

        elBalBtc.textContent = balanceBtc;
        elTotRecv.textContent = receivedBtc;
        elTotSent.textContent = sentBtc;
        elTxCount.textContent = txCount.toLocaleString();

        // USD Value
        if (currentBtcPrice > 0) {
            const usdValue = (balanceBtc * currentBtcPrice).toLocaleString('en-US', {
                style: 'currency',
                currency: 'USD'
            });
            elBalUsd.textContent = usdValue;
        } else {
            elBalUsd.textContent = 'USD Price Unavailable';
        }
    }

    function renderTxItem(txid, netChangeSats, feeSats, isConfirmed, timestamp, linkHref) {
        const isReceive = netChangeSats >= 0;
        const changeBtc = (Math.abs(netChangeSats) / 100000000).toFixed(8);

        const txEl = document.createElement('div');
        txEl.className = `tx-item ${isReceive ? 'tx-in' : 'tx-out'}`;

        const iconClass = isReceive ? 'fa-arrow-down' : 'fa-arrow-up';
        const sign = isReceive ? '+' : '-';
        
        let timeStr = 'Unconfirmed';
        if (isConfirmed && timestamp) {
            timeStr = new Date(timestamp * 1000).toLocaleString();
        }

        const feeDisplay = feeSats ? `<div class="tx-fee">Fee: ${feeSats} sats</div>` : '';

        txEl.innerHTML = `
            <div class="tx-type-icon">
                <i class="fa-solid ${iconClass}"></i>
            </div>
            <div class="tx-details">
                <a href="${linkHref}" target="_blank" class="tx-hash" title="${txid}">
                    ${txid.substring(0, 12)}...${txid.substring(txid.length - 12)}
                </a>
                <span class="tx-time">${timeStr}</span>
            </div>
            <div>
                <div class="tx-amount">${sign}${changeBtc} BTC</div>
                ${!isReceive ? feeDisplay : ''}
            </div>
        `;
        txList.appendChild(txEl);
    }

    function showError(msg) {
        errorMsg.innerHTML = msg;
        errorMsg.classList.remove('hidden');
    }

    function hideError() {
        errorMsg.classList.add('hidden');
    }
});
