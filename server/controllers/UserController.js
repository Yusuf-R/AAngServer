
class UserController {

    static async signup(req, res) {
        res.status(200).send({ message: "signup successful!" });
    }

    static async login(req, res) {
        res.status(200).send({ message: "Login successful!" });
    }

    static async logout(req, res) {
        res.status(200).send({ message: "Logout successful!" });
    }
}

module.exports = UserController;