-- ============================================================
-- pzsm_tracker.lua | by bazq
-- Server-side player position tracker for pz-modmanager
-- Writes player data to a JSON file for the desktop manager.
-- ============================================================

Config = {
    Debug         = false,
    TickInterval  = 100,  -- ticks between updates (approx 5 seconds at 20tps)
    OutputFile    = "pzsm_players.json",  -- saved in /Zomboid/Lua/
}

-- bazq debug helper
local function dbg(msg)
    if Config.Debug then
        print(("[bazq-pzsm_tracker] %s"):format(msg))
    end
end

-- ---- State ----
local tickCount   = 0
local lastPayload = ""

-- ---- Helpers ----

local function getStatus(player)
    if player:isAsleep() then return "Asleep" end
    if player:isInfected() then return "Infected" end
    if player:isZombie() then return "Zombie" end
    -- Check body damage for bleeding / bitten
    local bodyDamage = player:getBodyDamage()
    if bodyDamage then
        if bodyDamage:getBiteInfectionLevel() > 0 then return "Bitten" end
        if bodyDamage:getBleedingBodyParts() and bodyDamage:getBleedingBodyParts():size() > 0 then
            return "Bleeding"
        end
    end
    return "Healthy"
end

local function buildJSON()
    local players = getOnlinePlayers()
    if not players then return "[]" end

    local entries = {}
    for i = 0, players:size() - 1 do
        local player = players:get(i)
        if player then
            local x      = math.floor(player:getX())
            local y      = math.floor(player:getY())
            local z      = math.floor(player:getZ())
            local name   = player:getUsername() or "Unknown"
            local hp     = math.floor((player:getBodyDamage() and player:getBodyDamage():getOverallBodyHealth() or 100))
            local status = getStatus(player)

            -- Escape the name for JSON safety
            name = name:gsub('"', '\\"')

            entries[#entries + 1] = string.format(
                '{"name":"%s","x":%d,"y":%d,"z":%d,"hp":%d,"status":"%s"}',
                name, x, y, z, hp, status
            )
        end
    end

    return "[" .. table.concat(entries, ",") .. "]"
end

local function writeFile(payload)
    local path = getGameModeFolderPath() or ""
    -- Fallback to working directory
    local fullPath = (path ~= "" and path .. "/" or "") .. Config.OutputFile

    local file = io.open(fullPath, "w")
    if file then
        file:write(payload)
        file:close()
        dbg("Written " .. #payload .. " bytes to " .. fullPath)
    else
        dbg("ERROR: Could not open file for writing: " .. fullPath)
    end
end

-- ---- Main tick ----
local function onTick()
    tickCount = tickCount + 1
    if tickCount < Config.TickInterval then return end
    tickCount = 0

    local payload = buildJSON()

    -- Only write if data changed (dirty check)
    if payload == lastPayload then
        dbg("No change, skipping write.")
        return
    end

    lastPayload = payload
    writeFile(payload)
end

-- ---- Events ----
Events.OnTick.Add(onTick)

dbg("pzsm_tracker loaded. TickInterval=" .. Config.TickInterval)
