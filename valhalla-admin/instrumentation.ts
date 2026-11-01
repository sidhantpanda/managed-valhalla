export async function register() {
  // The admin manages files and child processes, which only the Node.js runtime can do.
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { boot } = await import('./lib/server/boot')
    // Not awaited: the server should answer while the catalog downloads.
    void boot()
  }
}
