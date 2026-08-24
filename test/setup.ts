/**
 * Keep the suite hermetic: a host with a real provider key exported would flip provider
 * auto-selection and turn forgotten fetch stubs into live requests on a real account.
 */
delete process.env.GOOGLE_MAPS_API_KEY;
