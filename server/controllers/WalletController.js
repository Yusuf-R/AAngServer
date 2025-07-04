import AuthController from "./AuthController";
import Wallet from "../models/Wallet";

const BIN_PREFIX = '2264';

class WalletController  {

    static async  generateUniqueWalletId() {
        let exists = true;
        let walletId = '';

        while (exists) {
            const rand12 = Math.floor(Math.random() * 1e12).toString().padStart(12, '0');
            walletId = BIN_PREFIX + rand12;
            exists = await Wallet.exists({ walletId });
        }

        return walletId;
    }

}

export default WalletController;