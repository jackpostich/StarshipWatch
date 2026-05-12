## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## 🤝 Contributing

Contributions are welcome! If you have ideas for new data points to track or UI improvements, please open an issue or submit a pull request.

---
*Disclaimer: This project is not affiliated with,This is a great project to showcase on GitHub. Since it involves scheduled tasks and database integration, a clear README will help users understand how the data flows from SpaceX to your Netlify site.

Here is a comprehensive README.md template tailored for **StarshipWatcher**.

***

# StarshipWatcher 🚀

**StarshipWatcher** is a real-time tracking dashboard for upcoming SpaceX Integrated Flight Tests (IFT). It provides the latest mission data, countdowns, and flight status by aggregating public API data into a centralized dashboard.

**Live Demo:** [starshipwatcher.netlify.app](https://starshipwatcher.netlify.app)

## 🛠 How It Works

The application operates as a data pipeline to ensure high availability and low latency for flight tracking:

1.  **Data Ingestion:** A specialized script fetches the latest mission updates from public SpaceX and space-flight telemetry APIs.
2.  **Storage:** Fetched data is processed and stored in a **Supabase** (PostgreSQL) instance, serving as the "Source of Truth" for the frontend.
3.  **Automation:** A **Netlify Scheduled Function** (Cron Job) triggers every 2 hours to refresh the Supabase records, ensuring the site remains up-to-date without manual intervention.
4.  **Frontend:** A lightweight web interface pulls data directly from Supabase for a fast, responsive user experience.

## 🏗 Tech Stack

*   **Frontend:** [Insert Framework, e.g., React/Vue/Svelte]
*   **Hosting:** [Netlify](https://www.netlify.com/)
*   **Database:** [Supabase](https://supabase.com/)
*   **Automation:** Netlify Functions / Edge Functions

## 🚀 Getting Started

### Prerequisites

*   Node.js (v18 or higher)
*   A Supabase account and project
*   Netlify CLI (for local testing of scheduled functions)

### Installation

1. **Clone the repository**
   ```bash
   git clone [https://github.com/jackpostich/starshipwatcher.git](https://github.com/jackpostich/starshipwatcher.git)
   cd starshipwatcher
Install dependencies

Bash
npm install
Environment Variables
Create a .env file in the root directory and add your credentials:

Code snippet
SUPABASE_URL=your_supabase_url
SUPABASE_KEY=your_supabase_anon_key
Run Locally

Bash
npm run dev
⏱ Scheduled Updates
The data refresh script is located in /netlify/functions/update-data.js. It is configured to run every 120 minutes via Netlify's cron scheduling.

JavaScript
// Example Schedule Configuration
export const config = {
  schedule: "0 */2 * * *"
};
📄 License
This project is licensed under the MIT License - see the LICENSE file for details.

🤝 Contributing
Contributions are welcome! If you have ideas for new data points to track or UI improvements, please open an issue or submit a pull request.

Disclaimer: This project is not affiliated with, authorized, or endorsed by SpaceX.
