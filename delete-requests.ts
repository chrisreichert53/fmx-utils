import axios from 'axios';
import dotenv from 'dotenv';
import * as Q from 'q';

(async () => {
  dotenv.config();

  // Environment Variables
  const { URL, USERNAME, PASSWORD } = process.env;

  // Configure the standard axios request
  const request = axios.create({
    baseURL: `https://${URL}/api/v1`,
    auth: {
      username: USERNAME,
      password: PASSWORD,
    },
  });

  try {
    // Get requests from past week
    const requests = await (
      await request.get('/maintenance-requests?fields=id&dateRange=PastWeek')
    ).data.slice(0, 100);

    // Delete requests from past week
    const deletePromises = requests.map(({ id }) => request.delete(`/maintenance-requests/${id}`));
    const deleteResults = await await Q.allSettled(deletePromises);
    console.log(
      deleteResults.map((res) =>
        res.state == 'fulfilled'
          ? res.state
          : res.reason && JSON.stringify(res.reason.toJSON().config.headers, null, 2)
      )
    );
  } catch (error) {
    console.error(error);
  }
})();
