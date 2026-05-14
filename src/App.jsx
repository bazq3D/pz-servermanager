import { useState, useRef, useEffect } from 'react';
import { Folder, ChevronLeft, ChevronRight, RotateCw, Home, Menu, ChevronDown, Trash2 } from 'lucide-react';
import './index.css';

// Default demo players shown when no tracker file is connected
const DEMO_PLAYERS = [];

function WorkshopBrowser({ activeInstance, setActiveInstance, instances = [], serverBuild }) {
  const webviewRef = useRef(null);
  const [currentUrl, setCurrentUrl] = useState('https://pzwiki.net/wiki/Mods');
  const [extractedModId, setExtractedModId] = useState(null);
  const [modStatus, setModStatus] = useState('CHECKING COMPATIBILITY...');
  const [installedMods, setInstalledMods] = useState([]);
  const [installedWorkshopIds, setInstalledWorkshopIds] = useState([]);
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);

  const [modNameCache, setModNameCache] = useState(() => {
    try {
      const saved = localStorage.getItem('pzsm_mod_names');
      return saved ? JSON.parse(saved) : {};
    } catch (e) {
      return {};
    }
  });

  const saveToCache = (idStr, name) => {
    setModNameCache(prev => {
      const updated = { ...prev, [idStr]: name };
      localStorage.setItem('pzsm_mod_names', JSON.stringify(updated));
      return updated;
    });
  };

  const fetchModNameFromSteam = async (workshopId) => {
    if (webviewRef.current) {
      try {
        const title = await webviewRef.current.executeJavaScript(`
          fetch('https://steamcommunity.com/sharedfiles/filedetails/?id=${workshopId}')
            .then(res => res.text())
            .then(text => {
              const match = text.match(/class="workshopItemTitle">([^<]+)</);
              return match ? match[1].trim() : null;
            }).catch(() => null)
        `);
        if (title) return title;
      } catch (e) {}
    }
    return null;
  };

  const getReadableModName = (modStr) => {
    if (modNameCache[modStr]) {
      return modNameCache[modStr];
    }

    let lookUpId = modStr;
    if (modStr.startsWith('Mod_')) {
      lookUpId = modStr.substring(4);
    }
    
    for (const build of Object.values(RECOMMENDED_MODS)) {
      for (const categoryGroup of build) {
        for (const mod of categoryGroup.mods) {
          if (mod.id === lookUpId || mod.name === modStr) {
            return mod.name;
          }
        }
      }
    }

    if (modStr.startsWith('Mod_')) {
      const wId = modStr.substring(4);
      if (!window.fetchingMods) window.fetchingMods = {};
      if (!window.fetchingMods[wId]) {
        window.fetchingMods[wId] = true;
        fetchModNameFromSteam(wId).then(title => {
          if (title) saveToCache(modStr, title);
        });
      }
    }

    return modStr;
  };

  useEffect(() => {
    const fetchInstalled = async () => {
      if (window.pzAPI && activeInstance) {
        try {
          const cfg = await window.pzAPI.getServerConfig(activeInstance);
          if (cfg) {
            if (cfg.Mods) {
              setInstalledMods(cfg.Mods.split(';').map(m => m.trim()).filter(Boolean));
            } else {
              setInstalledMods([]);
            }
            if (cfg.WorkshopItems) {
              setInstalledWorkshopIds(cfg.WorkshopItems.split(';').map(m => m.trim()).filter(Boolean));
            } else {
              setInstalledWorkshopIds([]);
            }
          }
        } catch (err) {
          setInstalledMods([]);
          setInstalledWorkshopIds([]);
        }
      }
    };
    fetchInstalled();
  }, [activeInstance]);

  useEffect(() => {
    const webview = webviewRef.current;
    if (!webview) return;

    const handleDidNavigate = (e) => {
      setCurrentUrl(e.url);
      
      const urlParams = new URLSearchParams(e.url.split('?')[1]);
      const modId = urlParams.get('id');
      if (modId) {
        setExtractedModId(modId);
        setModStatus('CHECKING COMPATIBILITY...');
        setTimeout(async () => {
          if (webviewRef.current) {
            try {
              const text = await webviewRef.current.executeJavaScript(`
                (function() {
                  const tags = Array.from(document.querySelectorAll('.workshopTags a')).map(a => a.innerText.toLowerCase());
                  const desc = document.querySelector('.workshopItemDescription') ? document.querySelector('.workshopItemDescription').textContent.toLowerCase() : '';
                  const title = document.querySelector('.workshopItemTitle') ? document.querySelector('.workshopItemTitle').textContent.toLowerCase() : '';
                  return tags.join(' ') + ' ' + desc + ' ' + title;
                })()
              `);
              
              const supportsB41 = text.includes('build 41') || text.includes('b41') || text.includes('41.');
              const supportsB42 = text.includes('build 42') || text.includes('b42') || text.includes('42.');
              
              const builds = [];
              if (supportsB41) builds.push('B41');
              if (supportsB42) builds.push('B42');
              
              if (builds.length > 0) {
                setModStatus(`SUPPORTS ${builds.join(' & ')}`);
              } else {
                setModStatus('VERSION NOT SPECIFIED');
              }
            } catch (e) {
              setModStatus('VERSION UNKNOWN');
            }
          }
        }, 1500);
      } else {
        setExtractedModId(null);
      }
    };

    const handleFailLoad = (e) => {
      console.error("Webview failed to load:", e);
    };

    webview.addEventListener('did-navigate', handleDidNavigate);
    webview.addEventListener('did-navigate-in-page', handleDidNavigate);
    webview.addEventListener('did-fail-load', handleFailLoad);

    return () => {
      webview.removeEventListener('did-navigate', handleDidNavigate);
      webview.removeEventListener('did-navigate-in-page', handleDidNavigate);
      webview.removeEventListener('did-fail-load', handleFailLoad);
    };
  }, []);

  const goBack = () => webviewRef.current?.goBack();
  const goForward = () => webviewRef.current?.goForward();
  const reload = () => webviewRef.current?.reload();
  const goHome = () => { if (webviewRef.current) webviewRef.current.src = 'https://steamcommunity.com/app/108600/workshop/'; };
  const navigateToMod = (id) => { if (webviewRef.current) webviewRef.current.src = `https://steamcommunity.com/sharedfiles/filedetails/?id=${id}`; };
  const searchWorkshop = (query) => { if (webviewRef.current) webviewRef.current.src = `https://steamcommunity.com/workshop/browse/?appid=108600&searchtext=${encodeURIComponent(query)}`; };

  const addModToServer = async () => {
    const workshopId = extractedModId;
    const placeholderModId = `Mod_${workshopId}`; 

    if (webviewRef.current) {
      try {
        const title = await webviewRef.current.executeJavaScript(`
          (function() {
            const el = document.querySelector('.workshopItemTitle');
            return el ? el.innerText : null;
          })()
        `);
        if (title) {
          saveToCache(placeholderModId, title.trim());
        }
      } catch (err) {}
    }

    if (window.pzAPI) {
      try {
        const result = await window.pzAPI.addModToServer(activeInstance, workshopId, placeholderModId);
        if (result.success) {
          alert(`Success! Added WorkshopID: ${workshopId} to [${activeInstance}]`);
          if (result.config) {
            if (result.config.Mods) setInstalledMods(result.config.Mods.split(';').map(m => m.trim()).filter(Boolean));
            if (result.config.WorkshopItems) setInstalledWorkshopIds(result.config.WorkshopItems.split(';').map(m => m.trim()).filter(Boolean));
          }
        } else {
          alert(`Failed to write to [${activeInstance}]`);
        }
      } catch (err) {
        alert('Error calling IPC: ' + err.message);
      }
    } else {
      alert(`[BROWSER MODE] Mod added to ${activeInstance}: ${extractedModId}`);
    }
  };

  const removeModFromServer = async (wId, mId, e) => {
    if (e) {
      e.stopPropagation();
      e.preventDefault();
    }
    
    if (window.pzAPI) {
      try {
        const result = await window.pzAPI.removeModFromServer(activeInstance, wId, mId);
        if (result.success) {
          if (result.config) {
            if (result.config.Mods) setInstalledMods(result.config.Mods.split(';').map(m => m.trim()).filter(Boolean));
            else setInstalledMods([]);
            if (result.config.WorkshopItems) setInstalledWorkshopIds(result.config.WorkshopItems.split(';').map(m => m.trim()).filter(Boolean));
            else setInstalledWorkshopIds([]);
          }
        } else {
          alert(`Failed to remove from [${activeInstance}]`);
        }
      } catch (err) {
        alert('Error calling IPC: ' + err.message);
      }
    }
  };

  return (
    <div style={{ display: 'flex', gap: '20px', height: 'calc(100vh - 110px)' }}>
      {/* Sidebar */}
      {!isSidebarOpen && (
        <div className="card" style={{ width: '40px', display: 'flex', flexDirection: 'column', gap: '0', overflow: 'hidden', padding: '0', flexShrink: 0, alignItems: 'center' }}>
          <button 
            style={{ width: '100%', padding: '12px 0', background: 'transparent', border: 'none', borderBottom: '1px solid var(--border-color)', color: 'var(--text-muted)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
            onClick={() => setIsSidebarOpen(true)}
            title="Open Panel"
          >
            <Menu size={16} />
          </button>
          <div style={{ writingMode: 'vertical-rl', textOrientation: 'mixed', padding: '20px 0', color: 'var(--text-muted)', fontSize: '0.8rem', fontWeight: 'bold', letterSpacing: '2px', cursor: 'pointer' }} onClick={() => setIsSidebarOpen(true)}>
            MOD MENU
          </div>
        </div>
      )}

      {isSidebarOpen && (
        <div className="card" style={{ width: '300px', display: 'flex', flexDirection: 'column', gap: '0', overflow: 'hidden', padding: '0', flexShrink: 0 }}>
          <div style={{ display: 'flex', borderBottom: '1px solid var(--border-color)', backgroundColor: 'rgba(0,0,0,0.2)' }}>
            <div style={{ flex: 1, padding: '12px', color: 'var(--accent-green)', fontWeight: 'bold', fontSize: '0.8rem', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              INSTALLED MODS ({installedMods.length})
            </div>
            <button 
              style={{ width: '40px', background: 'transparent', border: 'none', borderLeft: '1px solid var(--border-color)', color: 'var(--text-muted)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
              onClick={() => setIsSidebarOpen(false)}
              title="Close Panel"
            >
              <ChevronLeft size={16} />
            </button>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', overflowY: 'auto', flex: 1 }}>
            {installedMods.length === 0 && (
              <div style={{ padding: '20px 15px', color: 'var(--text-muted)', fontSize: '0.8rem', textAlign: 'center' }}>
                No mods found in {activeInstance}.ini
              </div>
            )}

            {installedMods.map((modName, idx) => (
              <div 
                key={idx} 
                style={{ 
                  padding: '12px 15px', 
                  borderBottom: '1px solid rgba(255,255,255,0.02)', 
                  transition: 'background 0.1s',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center'
                }}
                onMouseOver={(e) => e.currentTarget.style.backgroundColor = 'rgba(255,255,255,0.05)'}
                onMouseOut={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
              >
                <div 
                  style={{ flex: 1, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '8px' }}
                  onClick={() => {
                    if (modName.startsWith('Mod_') && /^\d+$/.test(modName.substring(4))) {
                      navigateToMod(modName.substring(4));
                    } else {
                      searchWorkshop(getReadableModName(modName));
                    }
                  }}
                  title={`Click to search on Steam Workshop (${modName})`}
                >
                  <div style={{ fontWeight: '500', color: 'var(--text-main)', fontSize: '0.88rem', wordBreak: 'break-all' }}>{getReadableModName(modName)}</div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                  <span style={{ fontSize: '0.65rem', color: 'var(--accent-green)', border: '1px solid rgba(164,208,7,0.3)', padding: '2px 6px', borderRadius: '4px' }}>ACTIVE</span>
                  <button 
                    style={{ background: 'transparent', border: 'none', color: '#ff4757', cursor: 'pointer', padding: '4px', display: 'flex', alignItems: 'center', opacity: 0.8 }}
                    onMouseOver={(e) => e.currentTarget.style.opacity = 1}
                    onMouseOut={(e) => e.currentTarget.style.opacity = 0.8}
                    title="Remove Mod"
                    onClick={(e) => {
                      let wId = null;
                      if (modName.startsWith('Mod_') && /^\d+$/.test(modName.substring(4))) {
                        wId = modName.substring(4);
                      }
                      removeModFromServer(wId, modName, e);
                    }}
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Browser Container */}
      <div className="browser-container" style={{ flex: 1, position: 'relative' }}>
        <div className="browser-toolbar">
          <button className="toolbar-btn" onClick={goBack} title="Back">
            <ChevronLeft size={18} />
          </button>
          <button className="toolbar-btn" onClick={goForward} title="Forward">
            <ChevronRight size={18} />
          </button>
          <button className="toolbar-btn" onClick={reload} title="Reload">
            <RotateCw size={16} />
          </button>
          <button className="toolbar-btn" onClick={goHome} title="Workshop Home">
            <Home size={16} />
          </button>
          <div className="url-bar">{currentUrl}</div>
        </div>
        
        <div className="webview-wrapper">
          {/* eslint-disable-next-line react/no-unknown-property */}
          <webview 
            ref={webviewRef}
            src="https://steamcommunity.com/app/108600/workshop/" 
            allowpopups="true"
          ></webview>
        </div>

        {extractedModId && (
          <div className="mod-extractor-overlay">
            <div style={{ display: 'flex', gap: '40px', alignItems: 'center' }}>
              <div>
                <div style={{ color: 'var(--text-muted)', fontSize: '0.75rem', textTransform: 'uppercase', marginBottom: '4px' }}>Target ID</div>
                <div className="mod-info-chip">{extractedModId}</div>
              </div>
              <div>
                <div style={{ color: 'var(--text-muted)', fontSize: '0.75rem', textTransform: 'uppercase', marginBottom: '4px' }}>Server Build</div>
                <div style={{ color: 'var(--accent-blue)', fontWeight: 'bold', fontSize: '0.9rem' }}>{serverBuild}</div>
              </div>
              <div>
                <div style={{ color: 'var(--text-muted)', fontSize: '0.75rem', textTransform: 'uppercase', marginBottom: '4px' }}>Mod Supports</div>
                <div style={{ 
                  color: modStatus.includes(serverBuild) ? 'var(--accent-green)' : (modStatus.includes('NOT SPECIFIED') || modStatus.includes('UNKNOWN') ? 'var(--accent-amber)' : 'var(--accent-red)'),
                  fontWeight: '500',
                  fontSize: '0.9rem'
                }}>
                  {modStatus}
                </div>
              </div>
            </div>
            
            <div style={{ display: 'flex', gap: '10px', alignItems: 'stretch' }}>
              <select 
                className="server-dropdown" 
                value={activeInstance}
                onChange={(e) => setActiveInstance(e.target.value)}
                style={{ width: '180px', margin: 0, padding: '0 10px', backgroundColor: 'var(--bg-dark)' }}
              >
                {instances.map(inst => (
                  <option key={inst} value={inst}>{inst}</option>
                ))}
              </select>
              {installedWorkshopIds.includes(extractedModId) ? (
                <button 
                  className="btn btn-danger" 
                  style={{ minWidth: '50px', fontSize: '1rem', fontWeight: 'bold' }}
                  onClick={() => removeModFromServer(extractedModId, `Mod_${extractedModId}`)}
                  title="Remove Mod"
                >
                  <Trash2 size={16} />
                </button>
              ) : (
                <button 
                  className={modStatus.includes('UNSUPPORTED') ? "btn btn-danger" : "btn btn-success"} 
                  onClick={addModToServer}
                  style={{ minWidth: '50px', fontSize: '1.2rem', fontWeight: 'bold' }}
                  disabled={modStatus === 'CHECKING COMPATIBILITY...'}
                  title={modStatus.includes('UNSUPPORTED') ? 'Force Install' : 'Install Mod'}
                >
                  +
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

const CONFIG_SCHEMA = [
  {
    category: "SERVER NETWORK & CONNECTION",
    settings: [
      { key: "PublicName", type: "text", label: "Server Name" },
      { key: "PublicDescription", type: "text", label: "Server Description" },
      { key: "Public", type: "boolean", label: "Public Listing (Steam browser)" },
      { key: "Password", type: "text", label: "Server Password" },
      { key: "MaxPlayers", type: "number", label: "Max Players" },
      { key: "DefaultPort", type: "number", label: "Default Port" },
      { key: "UDPPort", type: "number", label: "UDP Port" },
      { key: "UPnP", type: "boolean", label: "Enable UPnP" },
      { key: "PingLimit", type: "number", label: "Ping Limit (ms)" },
      { key: "MaxAccountsPerUser", type: "number", label: "Max Accounts Per Steam User" },
      { key: "LoginQueueEnabled", type: "boolean", label: "Enable Login Queue" },
      { key: "server_browser_announced_ip", type: "text", label: "Announced IP" },
    ]
  },
  {
    category: "CONTENT LOAD ORDER (MODS & MAPS)",
    settings: [
      { key: "Map", type: "text", label: "Map Load Order" },
      { key: "Mods", type: "textarea", label: "Active Mod IDs" },
      { key: "WorkshopItems", type: "textarea", label: "Workshop IDs" },
    ]
  },
  {
    category: "PVP & COMBAT",
    settings: [
      { key: "PVP", type: "boolean", label: "PVP Enabled" },
      { key: "SafetySystem", type: "boolean", label: "Safety System (Skull icon)" },
      { key: "ShowSafety", type: "boolean", label: "Show Safety Icon" },
      { key: "SafetyToggleTimer", type: "number", label: "Safety Toggle Timer" },
      { key: "SafetyCooldownTimer", type: "number", label: "Safety Cooldown" },
      { key: "PVPMeleeWhileHitReaction", type: "boolean", label: "Melee While Hit Reaction" },
      { key: "PVPMeleeDamageModifier", type: "number", label: "Melee Damage Modifier" },
      { key: "PVPFirearmDamageModifier", type: "number", label: "Firearm Damage Modifier" },
    ]
  },
  {
    category: "CHAT & UI",
    settings: [
      { key: "GlobalChat", type: "boolean", label: "Enable Global Chat" },
      { key: "ChatStreams", type: "text", label: "Chat Streams" },
      { key: "DisplayUserName", type: "boolean", label: "Display Usernames Above Head" },
      { key: "ShowFirstAndLastName", type: "boolean", label: "Show First and Last Name" },
      { key: "SteamScoreboard", type: "text", label: "Steam Scoreboard (true/false/admin)" },
      { key: "ServerWelcomeMessage", type: "textarea", label: "Welcome Message" },
    ]
  },
  {
    category: "ENVIRONMENT & LOOT",
    settings: [
      { key: "HoursForLootRespawn", type: "number", label: "Loot Respawn (Hours)" },
      { key: "MaxItemsForLootRespawn", type: "number", label: "Max Items to Prevent Respawn" },
      { key: "ConstructionPreventsLootRespawn", type: "boolean", label: "Construction Prevents Loot Respawn" },
      { key: "ItemNumbersLimitPerContainer", type: "number", label: "Container Item Limit" },
      { key: "BloodSplatLifespanDays", type: "number", label: "Blood Splat Lifespan (Days)" },
      { key: "AllowDestructionBySledgehammer", type: "boolean", label: "Sledgehammer Destruction" },
      { key: "SledgehammerOnlyInSafehouse", type: "boolean", label: "Sledgehammer ONLY in Safehouse" },
      { key: "CarEngineAttractionModifier", type: "number", label: "Car Engine Noise Modifier" },
    ]
  },
  {
    category: "SAFEHOUSE SYSTEM",
    settings: [
      { key: "PlayerSafehouse", type: "boolean", label: "Players can claim Safehouses" },
      { key: "AdminSafehouse", type: "boolean", label: "Only Admins can claim Safehouses" },
      { key: "SafehouseAllowTrepass", type: "boolean", label: "Allow Trespassing" },
      { key: "SafehouseAllowFire", type: "boolean", label: "Allow Fire in Safehouse" },
      { key: "SafehouseAllowLoot", type: "boolean", label: "Allow Looting Safehouse" },
      { key: "SafehouseAllowRespawn", type: "boolean", label: "Respawn in Safehouse" },
      { key: "SafehouseAllowNonResidential", type: "boolean", label: "Claim Non-Residential Buildings" },
      { key: "SafehouseDaySurvivedToClaim", type: "number", label: "Days Survived to Claim" },
      { key: "SafeHouseRemovalTime", type: "number", label: "Auto Remove Time (Hours offline)" },
    ]
  },
  {
    category: "SURVIVAL & MECHANICS",
    settings: [
      { key: "PauseEmpty", type: "boolean", label: "Pause When Empty" },
      { key: "SleepAllowed", type: "boolean", label: "Sleep Allowed" },
      { key: "SleepNeeded", type: "boolean", label: "Sleep Needed" },
      { key: "KnockedDownAllowed", type: "boolean", label: "Knockdown Allowed" },
      { key: "SneakModeHideFromOtherPlayers", type: "boolean", label: "Sneak Hides from Players" },
      { key: "NoFire", type: "boolean", label: "Disable All Fires (Except Campfire)" },
      { key: "TrashDeleteAll", type: "boolean", label: "Enable Trash Delete All" },
      { key: "MinutesPerPage", type: "number", label: "Minutes Per Book Page" },
    ]
  },
  {
    category: "SPAWN & PLAYER ACCOUNTS",
    settings: [
      { key: "SpawnPoint", type: "text", label: "Global Spawn Point (X,Y,Z)" },
      { key: "SpawnItems", type: "text", label: "Starting Spawn Items" },
      { key: "Open", type: "boolean", label: "Open Server (No Whitelist Required)" },
      { key: "AutoCreateUserInWhiteList", type: "boolean", label: "Auto Create User in Whitelist" },
      { key: "DropOffWhiteListAfterDeath", type: "boolean", label: "Delete Whitelist on Death" },
      { key: "PlayerRespawnWithSelf", type: "boolean", label: "Respawn at Death Location" },
      { key: "PlayerRespawnWithOther", type: "boolean", label: "Respawn near other Players" },
    ]
  },
  {
    category: "DISCORD INTEGRATION",
    settings: [
      { key: "DiscordEnable", type: "boolean", label: "Enable Discord Bot" },
      { key: "DiscordToken", type: "text", label: "Bot Token" },
      { key: "DiscordChannel", type: "text", label: "Channel Name" },
      { key: "DiscordChannelID", type: "text", label: "Channel ID" },
    ]
  },
  {
    category: "SECURITY (VAC & ANTI-CHEAT)",
    settings: [
      { key: "SteamVAC", type: "boolean", label: "Enable Steam VAC" },
      { key: "DoLuaChecksum", type: "boolean", label: "Enforce LUA Checksum" },
      { key: "KickFastPlayers", type: "boolean", label: "Kick Speedhackers" },
      { key: "AntiCheatProtectionType1", type: "boolean", label: "Type 1 (Speedhack)" },
      { key: "AntiCheatProtectionType2", type: "boolean", label: "Type 2 (Multihack)" },
      { key: "AntiCheatProtectionType3", type: "boolean", label: "Type 3 (Item Spawner)" },
      { key: "AntiCheatProtectionType4", type: "boolean", label: "Type 4 (Godmode)" },
      { key: "AntiCheatProtectionType12", type: "boolean", label: "Type 12 (Invisible)" },
    ]
  }
];

function ServerConfigTab({ activeInstance }) {
  const [config, setConfig] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchConfig = async () => {
      setLoading(true);
      if (window.pzAPI && activeInstance) {
        try {
          const data = await window.pzAPI.getServerConfig(activeInstance);
          setConfig(data);
        } catch (err) {
          console.error("Failed to load config", err);
          setConfig(null);
        }
      } else {
        setConfig(null);
      }
      setLoading(false);
    };
    fetchConfig();
  }, [activeInstance]);

  if (loading) return <div>LOADING CONFIGURATION...</div>;
  if (!activeInstance) return <div>NO INSTANCE SELECTED. PLEASE SELECT A SERVER FIRST.</div>;
  if (!config) return <div>FAILED TO LOAD INI FILE FOR {activeInstance}.ini</div>;

  const handleInputChange = (key, value) => {
    setConfig(prev => ({ ...prev, [key]: value }));
  };

  const mappedKeys = new Set();
  CONFIG_SCHEMA.forEach(section => {
    section.settings.forEach(setting => mappedKeys.add(setting.key));
  });

  const unmappedKeys = Object.keys(config).filter(key => !mappedKeys.has(key));

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '15px' }}>
      {CONFIG_SCHEMA.map((section, idx) => (
        <div key={idx} className="card" style={{ display: 'flex', flexDirection: 'column', gap: '15px' }}>
          <h2 style={{ borderBottom: '1px solid var(--border-color)', paddingBottom: '8px', color: 'var(--accent-blue)', fontSize: '0.9rem', margin: 0 }}>
            {section.category}
          </h2>
          
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '15px' }}>
            {section.settings.map((setting) => (
              <div key={setting.key} style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
                <label style={{ color: 'var(--text-muted)', fontSize: '0.8rem', fontWeight: '500' }}>{setting.label}</label>
                
                {setting.type === 'boolean' && (
                  <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}>
                    <input 
                      type="checkbox" 
                      checked={config?.[setting.key] === 'true'} 
                      onChange={(e) => handleInputChange(setting.key, e.target.checked ? 'true' : 'false')}
                    />
                    <span style={{ color: config?.[setting.key] === 'true' ? 'var(--text-main)' : 'var(--text-muted)', fontSize: '0.85rem' }}>
                      {config?.[setting.key] === 'true' ? 'TRUE' : 'FALSE'}
                    </span>
                  </label>
                )}

                {(setting.type === 'text' || setting.type === 'number') && (
                  <input 
                    type={setting.type} 
                    value={config?.[setting.key] || ''} 
                    onChange={(e) => handleInputChange(setting.key, e.target.value)}
                    className="url-bar" 
                    style={{ width: '100%', outline: 'none' }} 
                  />
                )}

                {setting.type === 'textarea' && (
                  <textarea 
                    value={config?.[setting.key] || ''}
                    onChange={(e) => handleInputChange(setting.key, e.target.value)}
                    className="url-bar" 
                    style={{ width: '100%', height: '60px', resize: 'vertical', outline: 'none', fontFamily: 'monospace' }}
                  />
                )}
              </div>
            ))}
          </div>
        </div>
      ))}

      {unmappedKeys.length > 0 && (
        <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: '15px' }}>
          <h2 style={{ borderBottom: '1px solid var(--border-color)', paddingBottom: '8px', color: 'var(--accent-amber)', fontSize: '0.9rem', margin: 0 }}>
            MISCELLANEOUS (UNCATEGORIZED)
          </h2>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '15px' }}>
            {unmappedKeys.map(key => {
              const value = config[key];
              const isBoolean = value === 'true' || value === 'false';
              
              return (
                <div key={key} style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
                  <label style={{ color: 'var(--text-muted)', fontSize: '0.8rem', fontWeight: '500' }}>{key}</label>
                  {isBoolean ? (
                    <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}>
                      <input 
                        type="checkbox" 
                        checked={value === 'true'} 
                        onChange={(e) => handleInputChange(key, e.target.checked ? 'true' : 'false')}
                      />
                      <span style={{ color: value === 'true' ? 'var(--text-main)' : 'var(--text-muted)', fontSize: '0.85rem' }}>
                        {value === 'true' ? 'TRUE' : 'FALSE'}
                      </span>
                    </label>
                  ) : (
                    <input 
                      type="text" 
                      value={value || ''} 
                      onChange={(e) => handleInputChange(key, e.target.value)}
                      className="url-bar" 
                      style={{ width: '100%', outline: 'none' }} 
                    />
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      <div style={{ display: 'flex', justifyContent: 'flex-end', paddingTop: '10px' }}>
        <button className="btn btn-primary" onClick={() => alert('Save functionality not fully implemented in UI yet!')}>
          SAVE CONFIGURATION
        </button>
      </div>
    </div>
  );
}

function CustomFileEditor() {
  const [filePath, setFilePath] = useState(null);
  const [content, setContent] = useState('');
  const [originalContent, setOriginalContent] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  const handleSelectFile = async () => {
    if (window.pzAPI) {
      const result = await window.pzAPI.selectCustomFile();
      if (result) {
        setFilePath(result.filePath);
        setContent(result.content);
        setOriginalContent(result.content);
      }
    }
  };

  const handleSaveFile = async () => {
    if (window.pzAPI && filePath) {
      setIsSaving(true);
      const success = await window.pzAPI.saveCustomFile(filePath, content);
      setIsSaving(false);
      if (success) {
        setOriginalContent(content);
        alert('File saved successfully!');
      } else {
        alert('Failed to save file.');
      }
    }
  };

  const hasChanges = content !== originalContent;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px', height: 'calc(100vh - 120px)' }}>
      <div className="card" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ flex: 1, overflow: 'hidden' }}>
          <div style={{ color: 'var(--text-muted)', fontSize: '0.75rem', textTransform: 'uppercase', marginBottom: '5px' }}>
            TARGET FILE
          </div>
          <div style={{ color: filePath ? 'var(--accent-blue)' : 'var(--text-muted)', fontSize: '0.9rem', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', fontFamily: 'monospace' }}>
            {filePath ? filePath : 'No file selected...'}
          </div>
        </div>
        <div style={{ display: 'flex', gap: '10px' }}>
          <button className="btn btn-primary" onClick={handleSelectFile}>
            <Folder size={16} style={{ display: 'inline', verticalAlign: 'text-bottom', marginRight: '5px' }} /> 
            BROWSE FILE
          </button>
          <button 
            className={hasChanges ? "btn btn-success" : "btn"} 
            style={!hasChanges ? { backgroundColor: 'var(--bg-panel-hover)', cursor: 'not-allowed', color: 'var(--text-muted)' } : {}}
            onClick={handleSaveFile}
            disabled={!hasChanges || isSaving}
          >
            {isSaving ? 'SAVING...' : 'SAVE CHANGES'}
          </button>
        </div>
      </div>

      <div className="card" style={{ flex: 1, display: 'flex', flexDirection: 'column', padding: 0, overflow: 'hidden' }}>
        <div style={{ padding: '10px 15px', borderBottom: '1px solid var(--border-color)', backgroundColor: 'rgba(0,0,0,0.2)', fontSize: '0.8rem', color: 'var(--text-muted)' }}>
          RAW TEXT EDITOR
        </div>
        <textarea 
          value={content}
          onChange={(e) => setContent(e.target.value)}
          disabled={!filePath}
          spellCheck="false"
          style={{ 
            flex: 1, 
            width: '100%', 
            padding: '15px', 
            backgroundColor: 'var(--bg-panel)', 
            color: 'var(--text-main)', 
            border: 'none', 
            outline: 'none', 
            fontFamily: 'Consolas, monospace', 
            fontSize: '0.9rem',
            resize: 'none',
            whiteSpace: 'pre',
            overflowWrap: 'normal',
            overflowX: 'auto'
          }}
          placeholder={filePath ? "Start typing..." : "Please browse and select a file to edit..."}
        />
      </div>
    </div>
  );
}

function App() {
  // --- All state declarations (must be before any useEffect) ---
  const webviewRef = useRef(null);
  const consoleRef = useRef(null);
  const [activeTab, setActiveTab] = useState('dashboard');
  const [livePlayers, setLivePlayers] = useState(DEMO_PLAYERS);
  const [trackerFile, setTrackerFile] = useState(null);
  const [trackerConnected, setTrackerConnected] = useState(false);
  const [activeInstance, setActiveInstance] = useState('');
  const [instances, setInstances] = useState([]);
  const [searchDir, setSearchDir] = useState('');
  const [isMainSidebarOpen, setIsMainSidebarOpen] = useState(true);
  
  const [serverExePath, setServerExePath] = useState(null);
  const [serverStates, setServerStates] = useState({});
  const [serverLogs, setServerLogs] = useState({});
  const [serverBuilds, setServerBuilds] = useState(() => {
    try { return JSON.parse(localStorage.getItem('pzsm_server_builds')) || {}; }
    catch(e) { return {}; }
  });

  const currentState = serverStates[activeInstance] || 'offline';

  // Subscribe to live player updates from Electron main process
  useEffect(() => {
    if (!window.pzAPI) return;
    const cleanupPlayers = window.pzAPI.onPlayersUpdated((players) => {
      setLivePlayers(players);
      // Also push to webview blips
      const webview = webviewRef.current;
      if (webview && webview.executeJavaScript) {
        webview.executeJavaScript(`if (window.updatePZPlayers) window.updatePZPlayers(${JSON.stringify(players)});`).catch(() => {});
      }
    });

    const cleanupLog = window.pzAPI.onServerLog(({ instanceName, log }) => {
      setServerLogs(prev => ({
        ...prev,
        [instanceName]: (prev[instanceName] || '') + log
      }));
      if (consoleRef.current) {
        setTimeout(() => {
          if (consoleRef.current) consoleRef.current.scrollTop = consoleRef.current.scrollHeight;
        }, 50);
      }
    });

    const cleanupState = window.pzAPI.onServerState(({ instanceName, state }) => {
      setServerStates(prev => ({ ...prev, [instanceName]: state }));
    });

    return () => { 
      if (cleanupPlayers) cleanupPlayers(); 
      if (cleanupLog) cleanupLog();
      if (cleanupState) cleanupState();
    };
  }, []);

  // Connect to tracker file
  const handleConnectTracker = async () => {
    if (!window.pzAPI) return;
    const file = await window.pzAPI.selectPlayersFile();
    if (!file) return;
    const result = await window.pzAPI.setPlayersFile(file);
    if (result.success) {
      setTrackerFile(file);
      setTrackerConnected(true);
      setLivePlayers(result.players || []);
    }
  };

  const handleDisconnectTracker = async () => {
    if (window.pzAPI) await window.pzAPI.stopPlayersWatcher();
    setTrackerFile(null);
    setTrackerConnected(false);
    setLivePlayers(DEMO_PLAYERS);
  };


  // Inject blip script into webview when map tab is active
  useEffect(() => {
    const webview = webviewRef.current;
    if (!webview || activeTab !== 'map') return;

    let isReady = false;
    let interval = null;

    const handleDomReady = () => {
      isReady = true;
      webview.executeJavaScript(`
        if (!window.pzManagerInjected) {
          window.pzManagerInjected = true;
          window.pzPlayerOverlays = {};
          window.updatePZPlayers = function(players) {
            let viewer = null;
            if (window.g && window.g.viewer) viewer = window.g.viewer;
            else if (window.viewer) viewer = window.viewer;
            if (!viewer) return;
            const currentNames = players.map(p => p.name);
            for (const name in window.pzPlayerOverlays) {
              if (!currentNames.includes(name)) {
                const el = window.pzPlayerOverlays[name];
                if (viewer.removeOverlay) viewer.removeOverlay(el);
                else if (el.remove) el.remove();
                delete window.pzPlayerOverlays[name];
              }
            }
            players.forEach(p => {
              let el = window.pzPlayerOverlays[p.name];
              if (!el) {
                el = document.createElement('div');
                el.style.cssText = 'width:12px;height:12px;border-radius:50%;border:2px solid white;box-shadow:0 0 6px black;transform:translate(-50%,-50%);position:relative;cursor:pointer;';
                const label = document.createElement('div');
                label.innerText = p.name;
                label.style.cssText = 'position:absolute;top:14px;left:50%;transform:translateX(-50%);color:white;font-size:11px;font-weight:bold;text-shadow:1px 1px 3px black;white-space:nowrap;';
                el.appendChild(label);
                window.pzPlayerOverlays[p.name] = el;
              }
              el.style.backgroundColor = p.status === 'Healthy' ? '#a4d007' : p.status === 'Bitten' || p.status === 'Infected' ? '#ff4d4d' : '#ffb347';
              if (viewer.addOverlay && window.OpenSeadragon) {
                try {
                  let point;
                  if (window.c && window.c.getViewportPointBySquare && window.g && window.g.base_map) {
                    point = window.c.getViewportPointBySquare(viewer, window.g.base_map, p.x, p.y, 0);
                  } else {
                    point = new window.OpenSeadragon.Point(p.x / 30000, p.y / 30000);
                  }
                  try { viewer.updateOverlay(el, point, window.OpenSeadragon.Placement.CENTER); }
                  catch(e) { viewer.addOverlay({element: el, location: point, placement: window.OpenSeadragon.Placement.CENTER}); }
                } catch(e) {}
              }
            });
          };
        }
      `).catch(() => {});

      if (!interval) {
        interval = setInterval(() => {
          if (isReady && webview && webview.executeJavaScript) {
            webview.executeJavaScript(`if(window.updatePZPlayers)window.updatePZPlayers(${JSON.stringify(livePlayers)});`).catch(() => {});
          }
        }, 3000);
      }
    };

    webview.addEventListener('dom-ready', handleDomReady);
    return () => {
      webview.removeEventListener('dom-ready', handleDomReady);
      if (interval) clearInterval(interval);
      isReady = false;
    };
  }, [activeTab, livePlayers]);

  const fetchInstances = async () => {
    if (window.pzAPI) {
      try {
        const config = await window.pzAPI.getAppConfig();
        if (config && config.serverExePath) setServerExePath(config.serverExePath);

        const states = await window.pzAPI.getServerStates();
        setServerStates(states || {});

        const result = await window.pzAPI.getAvailableInstances();
        setInstances(result.instances);
        setSearchDir(result.dir);
        if (result.instances.length > 0) {
          setActiveInstance(result.instances[0]);
        } else {
          setActiveInstance('');
        }
      } catch (err) {
        console.error("Failed to load instances", err);
      }
    }
  };

  useEffect(() => {
    fetchInstances();
  }, []);

  const handleBrowseCustomFolder = async () => {
    if (window.pzAPI) {
      const newDir = await window.pzAPI.selectCustomDirectory();
      if (newDir) {
        await fetchInstances();
      }
    }
  };

  const handleSelectServerExe = async () => {
    if (window.pzAPI) {
      const exe = await window.pzAPI.selectServerExe();
      if (exe) setServerExePath(exe);
    }
  };

  const toggleServer = async () => {
    if (!window.pzAPI || !activeInstance) return;
    
    if (!serverExePath) {
      alert("Please select your StartServer64.bat file first!");
      return;
    }

    if (currentState === 'offline') {
      setServerStates(prev => ({ ...prev, [activeInstance]: 'starting' }));
      setServerLogs(prev => ({ ...prev, [activeInstance]: '[SYSTEM] Initiating server launch...\n' }));
      const res = await window.pzAPI.startServer(activeInstance);
      if (!res.success) {
        setServerStates(prev => ({ ...prev, [activeInstance]: 'offline' }));
        setServerLogs(prev => ({ ...prev, [activeInstance]: (prev[activeInstance] || '') + `[ERROR] ${res.error}\n` }));
      } else {
        setServerStates(prev => ({ ...prev, [activeInstance]: 'online' }));
      }
    } else {
      const res = await window.pzAPI.stopServer(activeInstance);
      if (res.success) {
        setServerLogs(prev => ({ ...prev, [activeInstance]: (prev[activeInstance] || '') + '[SYSTEM] Sent quit command to server...\n' }));
      }
    }
  };

  return (
    <>
      {isMainSidebarOpen && (
        <div className="sidebar no-drag">
          <div className="sidebar-logo">PZSM MANAGER</div>
        
        <div className="server-selector">
          <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: '5px', textTransform: 'uppercase' }}>Active Instance</div>
          {instances.length > 0 ? (
            <div style={{ display: 'flex', gap: '5px', marginBottom: '10px' }}>
              <select 
                className="server-dropdown" 
                value={activeInstance}
                onChange={(e) => setActiveInstance(e.target.value)}
                style={{ flex: 1, minWidth: 0, margin: 0 }}
              >
                {instances.map(inst => (
                  <option key={inst} value={inst}>{inst}</option>
                ))}
              </select>
              <select
                value={serverBuilds[activeInstance] || 'B41'}
                onChange={(e) => {
                  const nb = { ...serverBuilds, [activeInstance]: e.target.value };
                  setServerBuilds(nb);
                  localStorage.setItem('pzsm_server_builds', JSON.stringify(nb));
                }}
                style={{ width: '60px', padding: '0 5px', background: 'var(--bg-dark)', color: 'var(--text-main)', border: '1px solid var(--border-color)', borderRadius: '4px' }}
                title="Server Build Version"
              >
                <option value="B41">B41</option>
                <option value="B42">B42</option>
              </select>
            </div>
          ) : (
            <div style={{ color: 'var(--accent-red)', fontSize: '0.8rem', marginBottom: '10px' }}>No servers found.</div>
          )}

          <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginBottom: '4px', wordBreak: 'break-all' }}>
            DIR: {searchDir}
          </div>
          <button 
            className="btn btn-primary" 
            style={{ width: '100%', fontSize: '0.8rem', padding: '6px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px' }}
            onClick={handleBrowseCustomFolder}
          >
            <Folder size={16} /> BROWSE FOLDER
          </button>
        </div>

        <div className="sidebar-nav">
          <div 
            className={`nav-item ${activeTab === 'dashboard' ? 'active' : ''}`}
            onClick={() => setActiveTab('dashboard')}
          >
            DASHBOARD
          </div>
          <div 
            className={`nav-item ${activeTab === 'mods' ? 'active' : ''}`}
            onClick={() => setActiveTab('mods')}
          >
            MOD MANAGER
          </div>
          <div 
            className={`nav-item ${activeTab === 'config' ? 'active' : ''}`}
            onClick={() => setActiveTab('config')}
          >
            CONFIGURATION
          </div>
          <div 
            className={`nav-item ${activeTab === 'players' ? 'active' : ''}`}
            onClick={() => setActiveTab('players')}
          >
            PLAYERS & ADMIN
          </div>
          <div 
            className={`nav-item ${activeTab === 'map' ? 'active' : ''}`}
            onClick={() => setActiveTab('map')}
          >
            LIVE MAP
          </div>
          <div 
            className={`nav-item ${activeTab === 'custom' ? 'active' : ''}`}
            onClick={() => setActiveTab('custom')}
          >
            CUSTOM FILES
          </div>
        </div>
        </div>
      )}

      <div className="main-content no-drag">
        <div className="header">
          <div style={{ display: 'flex', alignItems: 'center', gap: '15px' }}>
            <button 
              onClick={() => setIsMainSidebarOpen(!isMainSidebarOpen)}
              style={{ background: 'transparent', border: 'none', color: 'var(--text-main)', cursor: 'pointer', display: 'flex', alignItems: 'center', padding: 0 }}
              title="Toggle Menu"
            >
              <Menu size={24} />
            </button>
            <h1>{activeTab.toUpperCase()}</h1>
          </div>
          <div className="server-status">
            <span>{currentState}</span>
            <div className={`status-indicator ${currentState === 'online' ? 'online' : ''}`}></div>
          </div>
        </div>

        {activeTab === 'dashboard' && (
          <>
            <div className="grid">
              <div className="card">
                <div className="card-title">PROCESS CONTROLS</div>
                <div style={{ display: 'flex', gap: '10px', marginTop: '15px' }}>
                  {currentState === 'offline' ? (
                    <button className="btn btn-success" onClick={toggleServer} disabled={!activeInstance || !serverExePath}>
                      START SERVER
                    </button>
                  ) : (
                    <button className="btn btn-danger" onClick={toggleServer}>
                      {currentState === 'starting' ? 'CANCEL' : 'STOP SERVER'}
                    </button>
                  )}
                  <button className="btn btn-primary" disabled={currentState !== 'online'}>
                    RESTART
                  </button>
                </div>
              </div>
              <div className="card">
                <div className="card-title">SERVER EXECUTABLE</div>
                <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '5px', wordBreak: 'break-all' }}>
                  {serverExePath || "Not configured. Select StartServer64.bat"}
                </div>
                <button className="btn btn-secondary" style={{ marginTop: '10px', width: '100%', fontSize: '0.8rem' }} onClick={handleSelectServerExe}>
                  BROWSE SERVER EXE
                </button>
              </div>
              <div className="card">
                <div className="card-title">PLAYERS ONLINE</div>
                <div className="card-value">0 / 32</div>
              </div>
            </div>

            <div style={{ marginTop: '25px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div style={{ color: 'var(--accent-blue)', fontSize: '0.85rem', textTransform: 'uppercase', letterSpacing: '1px' }}>SYSTEM CONSOLE ({activeInstance})</div>
            </div>
            <div className="console-view" ref={consoleRef}>
              {!serverLogs[activeInstance] && (
                <>
                  <p style={{color: '#66c0f4'}}>[SYSTEM] Initializing Project Zomboid Server Manager...</p>
                  <p style={{color: '#8f98a0'}}>[SYSTEM] Scanning Directory: {searchDir}</p>
                  {activeInstance ? (
                    <>
                      <p style={{color: '#8f98a0'}}>[SYSTEM] Instance selected: {activeInstance}</p>
                      <p style={{color: '#8f98a0'}}>[SYSTEM] Loading configuration from {activeInstance}.ini</p>
                      {!serverExePath && <p style={{color: '#ffb347'}}>[WARNING] Server executable not set. Please browse for StartServer64.bat to launch.</p>}
                    </>
                  ) : (
                    <p style={{color: '#8f2a2a'}}>[WARNING] No instances found! Please install a Zomboid server first or browse for a custom folder.</p>
                  )}
                </>
              )}
              {serverLogs[activeInstance] && (
                <pre style={{ margin: 0, whiteSpace: 'pre-wrap', wordWrap: 'break-word', color: '#fff', fontSize: '0.85rem', fontFamily: 'monospace' }}>
                  {serverLogs[activeInstance]}
                </pre>
              )}
            </div>
          </>
        )}

        {activeTab === 'mods' && (
          <WorkshopBrowser activeInstance={activeInstance} setActiveInstance={setActiveInstance} instances={instances} serverBuild={serverBuilds[activeInstance] || 'B41'} />
        )}

        {activeTab === 'config' && (
          <ServerConfigTab activeInstance={activeInstance} />
        )}

        {activeTab === 'custom' && (
          <CustomFileEditor />
        )}

        {activeTab === 'map' && (
          <div style={{ display: 'flex', gap: '20px', height: 'calc(100vh - 120px)' }}>
            {/* Players Panel */}
            <div className="card" style={{ width: '260px', display: 'flex', flexDirection: 'column', gap: '0', padding: 0, overflow: 'hidden' }}>
              <div style={{ padding: '12px 15px', borderBottom: '1px solid var(--border-color)', backgroundColor: 'rgba(0,0,0,0.2)' }}>
                <h2 style={{ fontSize: '0.85rem', color: 'var(--accent-blue)', margin: 0, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  ACTIVE PLAYERS
                  <span style={{ color: trackerConnected ? 'var(--accent-green)' : 'var(--text-muted)' }}>
                    {livePlayers.length} / 32
                  </span>
                </h2>
                {trackerConnected && (
                  <div style={{ fontSize: '0.65rem', color: 'var(--accent-green)', marginTop: '4px', wordBreak: 'break-all', opacity: 0.7 }}>
                    ● LIVE: {trackerFile?.split(/[\/\\]/).pop()}
                  </div>
                )}
                {!trackerConnected && (
                  <div style={{ fontSize: '0.65rem', color: 'var(--accent-amber)', marginTop: '4px', opacity: 0.7 }}>
                    ⚠ Demo data — connect tracker to go live
                  </div>
                )}
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', overflowY: 'auto', flex: 1 }}>
                {livePlayers.length === 0 && (
                  <div style={{ padding: '20px 15px', color: 'var(--text-muted)', fontSize: '0.8rem', textAlign: 'center' }}>
                    No players online
                  </div>
                )}
                {livePlayers.map((p, i) => (
                  <div key={i} style={{ padding: '10px 15px', borderBottom: '1px solid rgba(255,255,255,0.02)', display: 'flex', flexDirection: 'column', gap: '3px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span style={{ color: 'var(--text-main)', fontWeight: 'bold', fontSize: '0.88rem' }}>{p.name}</span>
                      <span style={{
                        fontSize: '0.68rem',
                        color: p.status === 'Healthy' ? 'var(--accent-green)' : p.status === 'Infected' || p.status === 'Bitten' ? 'var(--accent-red)' : 'var(--accent-amber)',
                        fontWeight: '600'
                      }}>{p.status}</span>
                    </div>
                    <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', display: 'flex', justifyContent: 'space-between' }}>
                      <span>X:{p.x} Y:{p.y}</span>
                      {p.hp !== undefined && <span style={{ color: p.hp > 70 ? 'var(--accent-green)' : p.hp > 30 ? 'var(--accent-amber)' : 'var(--accent-red)' }}>HP:{p.hp}</span>}
                    </div>
                  </div>
                ))}
              </div>

              <div style={{ padding: '12px 15px', borderTop: '1px solid var(--border-color)', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                {!trackerConnected ? (
                  <button className="btn btn-success" style={{ width: '100%', fontSize: '0.75rem' }} onClick={handleConnectTracker}>
                    ⚡ CONNECT TRACKER
                  </button>
                ) : (
                  <button className="btn btn-danger" style={{ width: '100%', fontSize: '0.75rem' }} onClick={handleDisconnectTracker}>
                    DISCONNECT
                  </button>
                )}
                <div style={{ fontSize: '0.65rem', color: 'var(--text-muted)', textAlign: 'center', lineHeight: '1.4' }}>
                  Place <code style={{ color: 'var(--accent-blue)' }}>pzsm_tracker</code> mod in your server,
                  then browse to <code style={{ color: 'var(--accent-blue)' }}>pzsm_players.json</code>
                </div>
              </div>
            </div>

            {/* Map */}
            <div className="card" style={{ flex: 1, padding: 0, position: 'relative', overflow: 'hidden', border: '1px solid var(--border-color)', backgroundColor: '#000' }}>
              {/* eslint-disable-next-line react/no-unknown-property */}
              <webview 
                ref={webviewRef}
                src="https://map.projectzomboid.com/" 
                style={{ width: '100%', height: '100%', border: 'none' }}
                title="Official PZMap"
                id="pzmap-webview"
                allowpopups="true"
              ></webview>

              <div style={{ position: 'absolute', top: 12, right: 12, background: 'rgba(5, 10, 15, 0.9)', padding: '5px 10px', border: `1px solid ${trackerConnected ? 'rgba(164,208,7,0.4)' : 'rgba(102,192,244,0.3)'}`, borderRadius: '4px', display: 'flex', alignItems: 'center', gap: '7px', zIndex: 20 }}>
                <div className={`status-indicator ${trackerConnected ? 'online' : ''}`}></div>
                <span style={{ color: trackerConnected ? 'var(--accent-green)' : '#66c0f4', fontSize: '0.7rem', fontWeight: 'bold', letterSpacing: '1px' }}>
                  {trackerConnected ? 'TRACKER: LIVE' : 'OFFICIAL MAP ENGINE'}
                </span>
              </div>
            </div>
          </div>
        )}
      </div>
    </>
  );
}

export default App;
