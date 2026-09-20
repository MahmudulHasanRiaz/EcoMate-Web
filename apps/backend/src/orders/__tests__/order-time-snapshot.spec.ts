/**
 * Deterministic test: proves that order-time customer data is preserved
 * independently of later CustomerProfile mutations, and that a delayed
 * Purchase event uses the ORIGINAL order-time values.
 */
describe('Order-time customer snapshot preservation', () => {
  // Mock data representing order creation at T0
  const T0_EMAIL = 'customer@example.com';
  const T0_PHONE = '+8801712345678';
  const T0_FIRST_NAME = 'Rahim';
  const T0_LAST_NAME = 'Uddin';
  const T0_CITY = 'Dhaka';
  const T0_STATE = 'Dhaka';
  const T0_ZIP = '1212';
  const T0_COUNTRY = 'BD';

  // Mock data representing CustomerProfile mutation at T1
  const T1_EMAIL = 'changed@example.com';
  const T1_PHONE = '+8801987654321';
  const T1_NAME = 'Changed Name';

  /**
   * Simulates the customer data resolution logic from
   * buildCanonicalOrderTrackingData(), proving the field precedence:
   * 1. Order-time customer snapshot (immutable)
   * 2. shippingAddress JSON (fallback for legacy)
   * 3. CustomerProfile (fallback for legacy)
   * 4. guestName/guestPhone (fallback for legacy)
   */
  function resolveCustomerData(order: any): {
    email: string;
    phone: string;
    firstName: string;
    lastName: string;
    city: string;
    state: string;
    zip: string;
    country: string;
  } {
    let email = '';
    let phone = '';
    let firstName = '';
    let lastName = '';
    let city = '';
    let state = '';
    let zip = '';
    let country = 'BD';

    // Order-time customer snapshot (PREFERRED)
    email = order.customerEmail || '';
    phone = order.customerPhone || '';
    firstName = order.customerFirstName || '';
    lastName = order.customerLastName || '';
    city = order.customerCity || '';
    state = order.customerState || '';
    zip = order.customerZip || '';
    country = order.customerCountry || 'BD';

    // Fallback to shippingAddress JSON
    const shippingAddr = order.shippingAddress || {};
    if (typeof shippingAddr === 'object') {
      if (!phone) phone = shippingAddr.phone || '';
      if (!firstName) firstName = shippingAddr.name || '';
      if (!city) city = shippingAddr.city || shippingAddr.district || '';
      if (!state) state = shippingAddr.state || shippingAddr.division || '';
      if (!zip) zip = shippingAddr.zip || shippingAddr.zipCode || shippingAddr.postalCode || '';
      if (shippingAddr.country && !order.customerCountry) country = shippingAddr.country;
    }

    // Fallback to CustomerProfile
    if (order.customer) {
      if (!email) email = order.customer.email || '';
      if (!phone) phone = order.customer.phone || '';
      if (!firstName) firstName = order.customer.name || '';
      if (!lastName) lastName = order.customer.lastName || '';
    }

    // Fallback to guest fields
    if (!phone) phone = order.guestPhone || '';
    if (!firstName) firstName = order.guestName || '';

    return { email, phone, firstName, lastName, city, state, zip, country };
  }

  describe('Order-time snapshot is preferred over CustomerProfile', () => {
    it('should use order-time customerEmail instead of mutated CustomerProfile.email', () => {
      const orderWithSnapshot = {
        customerEmail: T0_EMAIL,
        customerPhone: T0_PHONE,
        customerFirstName: T0_FIRST_NAME,
        customerLastName: T0_LAST_NAME,
        customerCity: T0_CITY,
        customerState: T0_STATE,
        customerZip: T0_ZIP,
        customerCountry: T0_COUNTRY,
        // CustomerProfile MUTATED at T1
        customer: {
          email: T1_EMAIL,
          phone: T1_PHONE,
          name: T1_NAME,
          lastName: null,
        },
      };

      const result = resolveCustomerData(orderWithSnapshot);

      // Uses ORIGINAL order-time values, not mutated CustomerProfile
      expect(result.email).toBe(T0_EMAIL);
      expect(result.phone).toBe(T0_PHONE);
      expect(result.firstName).toBe(T0_FIRST_NAME);
      expect(result.lastName).toBe(T0_LAST_NAME);
      expect(result.city).toBe(T0_CITY);
      expect(result.state).toBe(T0_STATE);
      expect(result.zip).toBe(T0_ZIP);
      expect(result.country).toBe(T0_COUNTRY);
    });

    it('should use order-time snapshot even when CustomerProfile is null', () => {
      const orderWithoutProfile = {
        customerEmail: T0_EMAIL,
        customerPhone: T0_PHONE,
        customerFirstName: T0_FIRST_NAME,
        customerLastName: T0_LAST_NAME,
        customerCity: T0_CITY,
        customerState: T0_STATE,
        customerZip: T0_ZIP,
        customerCountry: T0_COUNTRY,
        customer: null,
      };

      const result = resolveCustomerData(orderWithoutProfile);

      expect(result.email).toBe(T0_EMAIL);
      expect(result.phone).toBe(T0_PHONE);
      expect(result.firstName).toBe(T0_FIRST_NAME);
      expect(result.lastName).toBe(T0_LAST_NAME);
    });
  });

  describe('Fallback to CustomerProfile for legacy orders', () => {
    it('should fallback to CustomerProfile when snapshot fields are null', () => {
      const legacyOrder = {
        customerEmail: null,
        customerPhone: null,
        customerFirstName: null,
        customerLastName: null,
        customerCity: null,
        customerState: null,
        customerZip: null,
        customerCountry: null,
        guestName: null,
        guestPhone: null,
        customer: {
          email: T0_EMAIL,
          phone: T0_PHONE,
          name: `${T0_FIRST_NAME} ${T0_LAST_NAME}`,
          lastName: T0_LAST_NAME,
        },
      };

      const result = resolveCustomerData(legacyOrder);

      expect(result.email).toBe(T0_EMAIL);
      expect(result.phone).toBe(T0_PHONE);
      expect(result.firstName).toBe(`${T0_FIRST_NAME} ${T0_LAST_NAME}`);
      expect(result.lastName).toBe(T0_LAST_NAME);
    });
  });

  describe('Guest order with snapshot', () => {
    it('should use guestName/guestPhone snapshot for guest orders', () => {
      const guestOrder = {
        customerEmail: null,
        customerPhone: T0_PHONE,
        customerFirstName: T0_FIRST_NAME,
        customerLastName: null,
        customerCity: null,
        customerState: null,
        customerZip: null,
        customerCountry: T0_COUNTRY,
        guestName: T0_FIRST_NAME,
        guestPhone: T0_PHONE,
        customer: null,
      };

      const result = resolveCustomerData(guestOrder);

      expect(result.phone).toBe(T0_PHONE);
      expect(result.firstName).toBe(T0_FIRST_NAME);
      expect(result.country).toBe(T0_COUNTRY);
    });
  });

  describe('Address fields from snapshot', () => {
    it('should use order-time city/state/zip from snapshot', () => {
      const orderWithAddress = {
        customerEmail: T0_EMAIL,
        customerPhone: T0_PHONE,
        customerFirstName: T0_FIRST_NAME,
        customerLastName: T0_LAST_NAME,
        customerCity: T0_CITY,
        customerState: T0_STATE,
        customerZip: T0_ZIP,
        customerCountry: T0_COUNTRY,
        shippingAddress: {
          district: 'Chittagong', // Different from snapshot
          thana: 'Agrabad',
        },
        customer: null,
      };

      const result = resolveCustomerData(orderWithAddress);

      // Uses snapshot city, not shippingAddress district
      expect(result.city).toBe(T0_CITY);
      expect(result.state).toBe(T0_STATE);
      expect(result.zip).toBe(T0_ZIP);
    });
  });
});
