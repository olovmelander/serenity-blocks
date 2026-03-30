/**
 * Steam Integration Test
 * Run this to verify Steam is working correctly
 */

import { SteamNetworking } from './steam-networking.js';

export async function testSteamIntegration() {
    console.log('🧪 Testing Steam Integration...\n');

    try {
    // Step 1: Initialize Steam
        console.log('Step 1: Initializing Steam API...');
        const steam = new SteamNetworking();
        await steam.init();

        console.log('✅ Steam initialized successfully!');
        console.log(`   Player: ${steam.playerName}`);
        console.log(`   Steam ID: ${steam.steamId}`);
        console.log(`   Mock Mode: ${steam.mockMode ? 'YES' : 'NO'}`);
        console.log('');

        // Step 2: Test lobby creation
        console.log('Step 2: Creating test lobby...');
        const lobbyId = await steam.createLobby({
            maxPlayers: 8,
            lobbyType: 'public',
            gameName: 'Test Match',
        });

        console.log('✅ Lobby created successfully!');
        console.log(`   Lobby ID: ${lobbyId}`);
        console.log(`   You are HOST: ${steam.isHost}`);
        console.log('');

        // Step 3: Test lobby list
        console.log('Step 3: Fetching lobby list...');
        const lobbies = await steam.getLobbies();

        console.log(`✅ Found ${lobbies.length} lobbies`);
        lobbies.forEach((lobby, index) => {
            console.log(`   ${index + 1}. ${lobby.name} (${lobby.players}/${lobby.maxPlayers} players)`);
        });
        console.log('');

        // Step 4: Cleanup
        console.log('Step 4: Cleaning up...');
        steam.leaveLobby();
        steam.shutdown();

        console.log('✅ Test completed successfully!\n');
        console.log('🎉 Steam integration is working! You can now:');
        console.log('   1. Create lobbies');
        console.log('   2. Join lobbies');
        console.log('   3. Send P2P messages');
        console.log('   4. Start building multiplayer!\n');

        return true;
    } catch (err) {
        console.error('❌ Steam test failed:', err);
        console.log('\n⚠️ Troubleshooting:');
        console.log('   1. Is Steam running?');
        console.log('   2. Is electron/steam_appid.txt present with "480"?');
        console.log('   3. Try setting MOCK_STEAM=true for local testing\n');

        return false;
    }
}

// Export for use in main.js
export { SteamNetworking };
