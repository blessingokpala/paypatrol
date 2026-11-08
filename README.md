# PayPatrol

PayPatrol checks invoices and spending requests against approval, supplier-recipient and budget controls. Payment integration uses PayPal Sandbox test money only.

## License

PayPatrol is licensed under the [MIT License](LICENSE). Third-party dependencies retain their own licenses.

## Public repository setup

The root `LICENSE` file lets GitHub recognise the MIT license and display its license link in the repository sidebar. 

GitHub hosts the source code; the running application remains published through Lovable. Never publish private keys, account credentials or private invoice documents. Existing review reports contain personal and payment-test details and require a privacy review before making the repository public. Ignoring a file does not remove it from existing repository history.

This project was built with [Lovable](https://lovable.dev).

## Build with Lovable

Open your project in the [Lovable editor](https://lovable.dev) and keep building.

- **Ship faster**: describe what you want to build and Lovable handles the code.
- **Stay in sync**: connect the project to GitHub and every change made in Lovable is committed straight to your repository.
- **Full ownership**: this code is yours. Push to your repository and your changes sync back into Lovable, ready for your next prompt.

## Development

Prefer working locally? You need Node.js and npm — [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating).

```sh
git clone <this-repository-url>
cd <repository-name>
npm i
npm run dev
```

## Built with

- TanStack Start
- TypeScript
- React
- Tailwind CSS
