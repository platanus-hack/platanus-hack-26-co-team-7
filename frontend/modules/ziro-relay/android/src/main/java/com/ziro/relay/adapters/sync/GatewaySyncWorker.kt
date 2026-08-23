package com.ziro.relay.adapters.sync

import android.content.Context
import androidx.work.CoroutineWorker
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import com.ziro.relay.RelayContainer
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL

/** Native HTTP gateway: retry-safe queue ownership stays below the React Native boundary. */
class GatewaySyncWorker(context: Context, params: WorkerParameters) : CoroutineWorker(context, params) {
    override suspend fun doWork(): Result = withContext(Dispatchers.IO) {
        RelayContainer.attach(applicationContext)
        val outbox = RelayContainer.gatewayOutbox
        val batch = outbox.nextBatch()
        if (batch.isEmpty()) return@withContext Result.success()
        val session = RelayContainer.secureSession.load()
        val baseUrl = RelayContainer.secureSession.apiBaseUrl()
        if (session == null || baseUrl == null) {
            outbox.recordTransportFailure(batch.map { it.id }, "Gateway configuration or secure session is missing.")
            return@withContext Result.retry()
        }
        try {
            val first = upload(baseUrl, session.accessToken, batch)
            val response = if (first.code == HttpURLConnection.HTTP_UNAUTHORIZED) {
                val refreshed = refresh(baseUrl, session.refreshToken) ?: run {
                    outbox.recordTransportFailure(batch.map { it.id }, "Authentication refresh failed; sign in again.")
                    return@withContext Result.retry()
                }
                RelayContainer.secureSession.save(refreshed)
                upload(baseUrl, refreshed.accessToken, batch)
            } else first
            if (response.code !in 200..299) {
                outbox.recordTransportFailure(batch.map { it.id }, "Gateway HTTP ${response.code}.")
                return@withContext Result.retry()
            }
            val results = JSONObject(response.body).getJSONArray("results")
            val batchIds = batch.mapTo(mutableSetOf()) { it.id }
            RelayContainer.gatewayOutbox.run {
                for (index in 0 until results.length()) {
                    val result = results.getJSONObject(index)
                    val id = result.optString("id")
                    if (id in batchIds) recordOutcome(id, result.getString("outcome"), result.optString("outcome").takeIf { it.startsWith("invalid") || it.startsWith("legacy") })
                }
            }
            Result.success()
        } catch (error: Exception) {
            outbox.recordTransportFailure(batch.map { it.id }, "Gateway transport failure: ${error.message ?: error.javaClass.simpleName}")
            Result.retry()
        }
    }

    private data class HttpResult(val code: Int, val body: String)
    private fun upload(base: String, token: String, items: List<GatewayOutboxItem>): HttpResult = request(
        "$base/api/v1/private/telegrams/batch", token, JSONObject().put("items", JSONArray(items.map { JSONObject(it.telegram) })).toString(),
    )
    private fun refresh(base: String, refreshToken: String): com.ziro.relay.adapters.session.SecureSession? {
        val response = request("$base/api/v1/private/auth/refresh", null, JSONObject().put("refresh_token", refreshToken).toString())
        if (response.code !in 200..299) return null
        val body = JSONObject(response.body)
        return com.ziro.relay.adapters.session.SecureSession(body.getString("access_token"), body.getString("refresh_token"), body.getInt("expires_in"))
    }
    private fun request(url: String, token: String?, body: String): HttpResult {
        val connection = URL(url).openConnection() as HttpURLConnection
        return try {
            connection.requestMethod = "POST"; connection.doOutput = true; connection.setRequestProperty("Content-Type", "application/json")
            token?.let { connection.setRequestProperty("Authorization", "Bearer $it") }
            connection.outputStream.use { it.write(body.toByteArray()) }
            val code = connection.responseCode
            val stream = if (code >= 400) connection.errorStream else connection.inputStream
            HttpResult(code, stream?.bufferedReader()?.use { it.readText() } ?: "")
        } finally { connection.disconnect() }
    }
    companion object {
        fun schedule(context: Context) {
            val request = OneTimeWorkRequestBuilder<GatewaySyncWorker>().setConstraints(
                androidx.work.Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build(),
            ).build()
            WorkManager.getInstance(context).enqueueUniqueWork("ziro-gateway-sync", ExistingWorkPolicy.KEEP, request)
        }
    }
}
