import fs from 'fs';
import path from 'path';

/**
 * Parses and manages Project Zomboid server .ini files.
 * Provides methods to safely read, modify, and save configurations,
 * with special handling for semicolon-separated lists (like Mods= and WorkshopItems=).
 */
export class PZIniParser {
  constructor(filePath) {
    this.filePath = filePath;
    this.contentLines = [];
    this.parsedConfig = {};
    
    if (fs.existsSync(filePath)) {
      this.load();
    }
  }

  /**
   * Loads and parses the INI file from disk.
   * Keeps track of the original lines so we can maintain comments and structure when saving.
   */
  load() {
    try {
      const fileContent = fs.readFileSync(this.filePath, 'utf-8');
      this.contentLines = fileContent.split(/\r?\n/);
      this.parsedConfig = {};

      for (let line of this.contentLines) {
        line = line.trim();
        // Ignore comments and empty lines
        if (!line || line.startsWith('#') || line.startsWith(';')) continue;
        
        // PZ ini files use Key=Value
        const equalsIndex = line.indexOf('=');
        if (equalsIndex !== -1) {
          const key = line.substring(0, equalsIndex).trim();
          const value = line.substring(equalsIndex + 1).trim();
          this.parsedConfig[key] = value;
        }
      }
    } catch (err) {
      console.error(`Error loading INI file from ${this.filePath}:`, err);
    }
  }

  /**
   * Gets a specific setting value.
   */
  get(key, defaultValue = null) {
    return this.parsedConfig[key] !== undefined ? this.parsedConfig[key] : defaultValue;
  }

  /**
   * Sets a specific setting value in memory.
   */
  set(key, value) {
    this.parsedConfig[key] = value.toString();
  }

  /**
   * Gets a semicolon-separated list as an array (e.g. for Mods= or WorkshopItems=).
   */
  getList(key) {
    const val = this.get(key, '');
    if (!val) return [];
    return val.split(';').map(item => item.trim()).filter(item => item.length > 0);
  }

  /**
   * Sets a semicolon-separated list from an array.
   */
  setList(key, arrayValues) {
    // Filter out empties and join by semicolon
    const cleanArray = arrayValues.filter(val => val && val.trim().length > 0);
    this.set(key, cleanArray.join(';'));
  }

  /**
   * Adds a new item to a semicolon-separated list.
   * Prevents duplicates.
   */
  appendToList(key, item) {
    const list = this.getList(key);
    if (!list.includes(item)) {
      list.push(item);
      this.setList(key, list);
    }
  }

  /**
   * Removes an item from a semicolon-separated list.
   */
  removeFromList(key, item) {
    const list = this.getList(key);
    const filteredList = list.filter(val => val !== item);
    this.setList(key, filteredList);
  }

  /**
   * Saves the modified configuration back to the disk.
   * It preserves the original structure and comments, only modifying the changed keys.
   */
  save() {
    try {
      const keysWritten = new Set();
      const newLines = [];

      // Update existing lines
      for (let line of this.contentLines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith(';')) {
          newLines.push(line);
          continue;
        }

        const equalsIndex = line.indexOf('=');
        if (equalsIndex !== -1) {
          const key = line.substring(0, equalsIndex).trim();
          if (this.parsedConfig[key] !== undefined) {
            // Replace the line with the updated value
            newLines.push(`${key}=${this.parsedConfig[key]}`);
            keysWritten.add(key);
          } else {
            newLines.push(line);
          }
        } else {
          newLines.push(line);
        }
      }

      // Add any new keys that weren't in the original file
      for (const [key, value] of Object.entries(this.parsedConfig)) {
        if (!keysWritten.has(key)) {
          newLines.push(`${key}=${value}`);
        }
      }

      fs.writeFileSync(this.filePath, newLines.join('\r\n'), 'utf-8');
      this.contentLines = newLines; // update cache
      return true;
    } catch (err) {
      console.error(`Error saving INI file to ${this.filePath}:`, err);
      return false;
    }
  }
}
