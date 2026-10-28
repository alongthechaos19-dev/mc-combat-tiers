# Discord sync — setup

This reads everyone's tier roles from your Discord server and rebuilds `players.js`.
You only do steps 1–4 once.

## 1. Create the bot
1. Go to https://discord.com/developers/applications and click **New Application**. Name it "MC Combat Tiers".
2. Open the **Bot** tab.
3. Scroll to **Privileged Gateway Intents** and turn **Server Members Intent** ON. Save.
4. Click **Reset Token**, then **Copy**. This is the bot's password, so don't share it with anyone.

## 2. Invite the bot to your server
1. Open the **OAuth2** tab and copy the **Client ID**.
2. Open this link, with your Client ID in place of `CLIENT_ID`:
   `https://discord.com/oauth2/authorize?client_id=CLIENT_ID&scope=bot&permissions=0`
3. Pick your server and click Authorize. You need "Manage Server" permission to do this.

The bot needs no permissions. It only reads roles and doesn't post anything.

## 3. Get your server ID
1. In Discord, go to **User Settings → Advanced** and turn on **Developer Mode**.
2. Right-click your server icon and choose **Copy Server ID**.

## 4. Fill in config.json
Open `config.json` in Notepad and replace the two placeholders with your token and server ID:
```json
{
  "token": "your bot token",
  "serverId": "123456789012345678"
}
```
`config.json` is already set to stay out of git, so the token won't get uploaded by accident.

## 5. Sync
Double-click **`sync-players.bat`** in the `mc-combat-tiers` folder, then refresh the website.
Run it again any time tiers change.

---

## How roles are read
- **Tier roles:** `T1 - Sword` through `T5 - Sword`. Spaces, dashes and capital letters don't matter.
  Gamemode names it understands:
  Vanilla (or Crystal), UHC, Pot, NethOP (or Neth OP), SMP, Sword, Axe, Mace, Diamond SMP, Cart.
- **Region roles (optional):** a role named exactly `NA`, `EU`, `AS`, `AU` or `SA` shows up as the player's region.
- **Two tier roles in the same gamemode:** the better tier is used.
- **Player name:** their server nickname, otherwise their Discord display name. Skins only show up
  if this matches their Minecraft username.

## When someone's Discord name isn't their Minecraft name
Add them to `names.json`, using their Discord username (or user ID):
```json
{
  "discordguy123": "RealMinecraftName"
}
```

## Errors
- **"rejected the bot token"**: the token in config.json is wrong. Reset it and paste the new one.
- **"can't see that server"**: the bot isn't in the server, or Server Members Intent is off.
- **"Server not found"**: the serverId is wrong.
- **"No tier roles found"**: the role names don't start with `T1`–`T5`.
