import * as Location from 'expo-location';

export interface LocationResult {
  latitude: number;
  longitude: number;
  accuracy: number;
  address: string;
  city: string;
  state: string;
  country: string;
  timestamp: string;
  source: 'gps' | 'wifi_triangulation' | 'network' | 'google_maps' | 'manual';
}

export class LocationService {
  // Background GPS tracking for pre-warming (CAPI interviewers)
  private static watchSubscription: Location.LocationSubscription | null = null;
  private static latestLocation: LocationResult | null = null;
  private static isTrackingActive: boolean = false;
  private static readonly LOCATION_FRESHNESS_THRESHOLD_MS = 5000; // 5 seconds - considered fresh (updated to match GPS interval)
  private static readonly LOCATION_STALE_THRESHOLD_MS = 10000; // 10 seconds - considered stale (updated proportionally)

  static async requestPermissions(): Promise<boolean> {
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      return status === 'granted';
    } catch (error) {
      console.error('Permission request error:', error);
      return false;
    }
  }

  /**
   * Start background GPS tracking for pre-warming (battery-efficient)
   * Uses Balanced accuracy for background tracking, upgrades to High when needed
   */
  static async startBackgroundTracking(): Promise<void> {
    try {
      // Check if already tracking
      if (this.isTrackingActive && this.watchSubscription) {
        console.log('📍 Background GPS tracking already active');
        return;
      }

      // Request permissions first
      const hasPermission = await this.requestPermissions();
      if (!hasPermission) {
        console.warn('⚠️ Location permission not granted - background tracking skipped');
        return;
      }

      console.log('📍 Starting background GPS tracking (pre-warming for CAPI interviews)...');

      // Start watching position with Balanced accuracy (battery-efficient)
      // CRITICAL FIX: Increased interval from 2s to 5s to prevent timing conflicts with navigation
      // 2-second updates were interfering with navigation transitions in production APK builds
      this.watchSubscription = await Location.watchPositionAsync(
        {
          accuracy: Location.Accuracy.Balanced,
          timeInterval: 5000, // Update every 5 seconds (increased from 2s to prevent navigation conflicts)
          distanceInterval: 10, // Update every 10 meters
        },
        async (location) => {
          try {
            // Update cached location (without geocoding for speed)
            // Geocoding will be done when snapshot is requested
            this.latestLocation = {
              latitude: location.coords.latitude,
              longitude: location.coords.longitude,
              accuracy: location.coords.accuracy || 0,
              address: '', // Will be filled when snapshot is requested
              city: '',
              state: '',
              country: '',
              timestamp: new Date().toISOString(),
              source: location.coords.accuracy && location.coords.accuracy < 100 ? 'gps' : 'wifi_triangulation',
            };

            // Log first successful location (then silent)
            if (!this.isTrackingActive) {
              console.log('✅ Background GPS tracking active - location cached');
            }
            this.isTrackingActive = true;
          } catch (error) {
            console.warn('⚠️ Error updating cached location:', error);
          }
        }
      );

      this.isTrackingActive = true;
      console.log('✅ Background GPS tracking started successfully');
    } catch (error) {
      console.error('❌ Failed to start background GPS tracking:', error);
      this.isTrackingActive = false;
    }
  }

  /**
   * Stop background GPS tracking (saves battery)
   */
  static stopBackgroundTracking(): void {
    try {
      if (this.watchSubscription) {
        this.watchSubscription.remove();
        this.watchSubscription = null;
        this.isTrackingActive = false;
        console.log('📍 Background GPS tracking stopped');
      }
    } catch (error) {
      console.error('❌ Error stopping background GPS tracking:', error);
    }
  }

  /**
   * Get latest cached location (if available)
   */
  static getLatestLocation(): LocationResult | null {
    return this.latestLocation;
  }

  /**
   * Get location snapshot - uses cached if fresh, otherwise gets fresh location
   * This is the main method to use when starting an interview
   */
  static async getLocationSnapshot(skipOnlineGeocoding: boolean = false): Promise<LocationResult> {
    try {
      const now = Date.now();
      const cachedLocation = this.latestLocation;

      // Check if cached location exists and is fresh (< 5 seconds old, updated to match GPS interval)
      if (cachedLocation && cachedLocation.timestamp) {
        const locationAge = now - new Date(cachedLocation.timestamp).getTime();
        
        if (locationAge < this.LOCATION_FRESHNESS_THRESHOLD_MS) {
          console.log(`⚡ Using cached location (${locationAge}ms old) - instant!`);
          
          // If geocoding is needed and not already done, do it now
          if (!skipOnlineGeocoding && (!cachedLocation.address || cachedLocation.address === '')) {
            const address = await this.reverseGeocode(
              cachedLocation.latitude,
              cachedLocation.longitude,
              skipOnlineGeocoding
            );
            return {
              ...cachedLocation,
              address: address.formatted,
              city: address.city,
              state: address.state,
              country: address.country,
            };
          }
          
          return cachedLocation;
        }

        // If cached location is stale (> 10 seconds), get fresh one
        // But GPS is already warmed, so it should be faster
        if (locationAge > this.LOCATION_STALE_THRESHOLD_MS) {
          console.log(`📍 Cached location stale (${locationAge}ms old) - getting fresh location (GPS warmed, should be fast)`);
        } else {
          console.log(`📍 Using cached location (${locationAge}ms old) - still acceptable`);
          // Still use cached if it's between 5-10 seconds old
          if (!skipOnlineGeocoding && (!cachedLocation.address || cachedLocation.address === '')) {
            const address = await this.reverseGeocode(
              cachedLocation.latitude,
              cachedLocation.longitude,
              skipOnlineGeocoding
            );
            return {
              ...cachedLocation,
              address: address.formatted,
              city: address.city,
              state: address.state,
              country: address.country,
            };
          }
          return cachedLocation;
        }
      }

      // No cached location or too stale - get fresh location
      // GPS should already be warmed from background tracking, so this should be faster
      console.log('📍 Getting fresh location snapshot (GPS pre-warmed)...');
      return await this.getCurrentLocation(skipOnlineGeocoding);
    } catch (error: any) {
      console.error('❌ Error getting location snapshot:', error);
      // Fallback to regular getCurrentLocation
      return await this.getCurrentLocation(skipOnlineGeocoding);
    }
  }

  static async getCurrentLocation(skipOnlineGeocoding: boolean = false): Promise<LocationResult> {
    try {
      // Request permissions first
      const hasPermission = await this.requestPermissions();
      if (!hasPermission) {
        throw new Error('Location permission denied');
      }

      // Try high accuracy GPS first
      try {
        const location = await Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.High,
        });

        const address = await this.reverseGeocode(location.coords.latitude, location.coords.longitude, skipOnlineGeocoding);

        return {
          latitude: location.coords.latitude,
          longitude: location.coords.longitude,
          accuracy: location.coords.accuracy || 0,
          address: address.formatted,
          city: address.city,
          state: address.state,
          country: address.country,
          timestamp: new Date().toISOString(),
          source: 'gps',
        };
      } catch (gpsError) {
        console.warn('GPS location failed, trying network location:', gpsError);
        
        // Fallback to network location (WiFi triangulation)
        const location = await Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.Balanced,
        });

        const address = await this.reverseGeocode(location.coords.latitude, location.coords.longitude, skipOnlineGeocoding);

        return {
          latitude: location.coords.latitude,
          longitude: location.coords.longitude,
          accuracy: location.coords.accuracy || 0,
          address: address.formatted,
          city: address.city,
          state: address.state,
          country: address.country,
          timestamp: new Date().toISOString(),
          source: 'wifi_triangulation',
        };
      }
    } catch (error: any) {
      console.error('Location detection failed:', error);
      throw new Error(`Location detection failed: ${error.message}`);
    }
  }

  static async reverseGeocode(latitude: number, longitude: number, skipOnlineGeocoding: boolean = false) {
    try {
      // Use Expo's built-in reverse geocoding (works offline on device)
      const addresses = await Location.reverseGeocodeAsync({
        latitude,
        longitude,
      });

      if (addresses.length > 0) {
        const address = addresses[0];
        return {
          formatted: `${address.street || ''} ${address.streetNumber || ''}, ${address.city || ''}, ${address.region || ''}, ${address.country || ''}`.trim(),
          street: `${address.street || ''} ${address.streetNumber || ''}`.trim(),
          city: address.city || '',
          state: address.region || '',
          country: address.country || '',
          postalCode: address.postalCode || '',
        };
      } else {
        // If skipOnlineGeocoding is true (offline mode), return coordinates only
        if (skipOnlineGeocoding) {
          console.log('📴 Offline mode - skipping online geocoding, returning coordinates only');
          return {
            formatted: `${latitude.toFixed(6)}, ${longitude.toFixed(6)}`,
            street: '',
            city: '',
            state: '',
            country: '',
            postalCode: '',
          };
        }
        // Fallback to free Nominatim API (only if online)
        return await this.reverseGeocodeNominatim(latitude, longitude);
      }
    } catch (error) {
      // If skipOnlineGeocoding is true (offline mode), return coordinates only
      if (skipOnlineGeocoding) {
        console.log('📴 Offline mode - Expo geocoding failed, returning coordinates only');
        return {
          formatted: `${latitude.toFixed(6)}, ${longitude.toFixed(6)}`,
          street: '',
          city: '',
          state: '',
          country: '',
          postalCode: '',
        };
      }
      console.warn('Expo reverse geocoding failed, trying Nominatim:', error);
      return await this.reverseGeocodeNominatim(latitude, longitude);
    }
  }

  static async reverseGeocodeNominatim(latitude: number, longitude: number) {
    try {
      // Check if online before making network request
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 3000);
        const testResponse = await fetch('https://www.google.com/favicon.ico', {
          method: 'HEAD',
          cache: 'no-cache',
          mode: 'no-cors',
          signal: controller.signal,
        });
        clearTimeout(timeoutId);
      } catch (testError) {
        // Not online, return coordinates only
        console.log('📴 Offline - skipping Nominatim reverse geocoding');
        return {
          formatted: `${latitude.toFixed(6)}, ${longitude.toFixed(6)}`,
          street: '',
          city: '',
          state: '',
          country: '',
          postalCode: '',
        };
      }

      const response = await fetch(
        `https://nominatim.openstreetmap.org/reverse?format=json&lat=${latitude}&lon=${longitude}&addressdetails=1`
      );
      
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      
      const data = await response.json();
      
      if (data && data.display_name) {
        return {
          formatted: data.display_name,
          street: data.address?.road || data.address?.house_number || '',
          city: data.address?.city || data.address?.town || data.address?.village || '',
          state: data.address?.state || data.address?.county || '',
          country: data.address?.country || '',
          postalCode: data.address?.postcode || '',
        };
      } else {
        throw new Error('No address data received from Nominatim');
      }
    } catch (error) {
      console.error('Nominatim reverse geocoding failed:', error);
      // Return coordinates only on error (works offline)
      return {
        formatted: `${latitude.toFixed(6)}, ${longitude.toFixed(6)}`,
        street: '',
        city: '',
        state: '',
        country: '',
        postalCode: '',
      };
    }
  }

  static formatLocationForDisplay(location: LocationResult): string {
    if (location.address && location.address !== `${location.latitude.toFixed(6)}, ${location.longitude.toFixed(6)}`) {
      return location.address;
    }
    
    return `${location.latitude.toFixed(6)}, ${location.longitude.toFixed(6)}`;
  }
}
